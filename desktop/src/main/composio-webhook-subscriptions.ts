/**
 * Register project webhook URL with Composio (V3 webhook_subscriptions API).
 * Delivers trigger payloads as type composio.trigger.message — composio-payload unwraps that envelope.
 */

import { composioApiKeyCandidates } from './composio-trigger-client'

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3.1'

function uniqueKeyOrder(...candidates: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of candidates) {
    const t = typeof c === 'string' ? c.trim() : ''
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function isUnauthorizedComposioError(message: string): boolean {
  return message.includes('failed (401):') || message.includes('10401') || message.includes('HTTP_Unauthorized')
}

export interface ComposioWebhookSubscriptionResult {
  id?: string
  secret?: string
  /** True when Composio already had this exact webhook URL registered. */
  reusedExisting?: boolean
}

/** Normalize webhook URLs so two registrations that differ only by query order / trailing slashes compare equal. */
export function webhookSubscriptionCompareKey(urlString: string): string {
  let u: URL
  try {
    u = new URL(urlString.trim())
  } catch {
    return urlString.trim().toLowerCase()
  }
  const path = u.pathname.replace(/\/+$/, '') || '/'
  const entries = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
  const sp = new URLSearchParams(entries)
  const q = sp.toString()
  return `${u.protocol}//${u.host.toLowerCase()}${path}${q ? `?${q}` : ''}`
}

function parseSubscriptionResponse(text: string): ComposioWebhookSubscriptionResult {
  try {
    const json = JSON.parse(text) as unknown
    const rec = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
    return {
      id: typeof rec.id === 'string' ? rec.id : undefined,
      secret: typeof rec.secret === 'string' ? rec.secret : undefined,
    }
  } catch {
    return {}
  }
}

export async function composioSubscribeTriggerWebhook(apiKey: string, webhookUrl: string): Promise<ComposioWebhookSubscriptionResult> {
  const res = await fetch(`${COMPOSIO_API_BASE}/webhook_subscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      webhook_url: webhookUrl,
      enabled_events: ['composio.trigger.message'],
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Composio webhook_subscriptions failed (${res.status}): ${text.slice(0, 500)}`)
  }
  return parseSubscriptionResponse(text)
}

function parseWebhookSubscriptionList(text: string): Array<{ id: string; webhook_url: string }> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  if (!json || typeof json !== 'object') return []
  const rec = json as Record<string, unknown>
  const raw = Array.isArray(rec.items)
    ? rec.items
    : Array.isArray(rec.results)
      ? rec.results
      : Array.isArray(rec.data)
      ? rec.data
      : Array.isArray(rec.webhook_subscriptions)
        ? rec.webhook_subscriptions
        : Array.isArray(json)
          ? json
          : []
  const out: Array<{ id: string; webhook_url: string }> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const webhook_url = typeof o.webhook_url === 'string' ? o.webhook_url : ''
    if (id && webhook_url) out.push({ id, webhook_url })
  }
  return out
}

export async function listComposioWebhookSubscriptions(apiKey: string): Promise<Array<{ id: string; webhook_url: string }>> {
  const res = await fetch(`${COMPOSIO_API_BASE}/webhook_subscriptions?limit=100`, {
    headers: { 'x-api-key': apiKey.trim() },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Composio list webhook_subscriptions failed (${res.status}): ${text.slice(0, 500)}`)
  }
  return parseWebhookSubscriptionList(text)
}

export async function deleteComposioWebhookSubscription(apiKey: string, id: string): Promise<void> {
  const res = await fetch(`${COMPOSIO_API_BASE}/webhook_subscriptions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey.trim() },
  })
  const text = await res.text()
  if (!res.ok && res.status !== 404) {
    throw new Error(`Composio delete webhook_subscriptions failed (${res.status}): ${text.slice(0, 500)}`)
  }
}

/** Try each candidate key so purge matches whichever credential owns the blocking subscription (Pi vs env vs ~/.composio). */
async function purgeNonMatchingWebhookSubscriptionsForKeys(
  purgeKeys: string[],
  targetKey: string,
): Promise<{ removed: number; maxListed: number }> {
  let removed = 0
  let maxListed = 0
  for (const k of uniqueKeyOrder(...purgeKeys)) {
    try {
      const subs = await listComposioWebhookSubscriptions(k)
      maxListed = Math.max(maxListed, subs.length)
      for (const s of subs) {
        if (webhookSubscriptionCompareKey(s.webhook_url) === targetKey) continue
        await deleteComposioWebhookSubscription(k, s.id)
        removed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isUnauthorizedComposioError(msg)) {
        // Normal when several candidates are configured (Pi vs env vs ~/.composio); another key may still purge.
        continue
      }
      console.warn('[composio-webhook] webhook subscription purge skipped for one API key:', msg)
    }
  }
  return { removed, maxListed }
}

/**
 * Register webhook with Composio, or treat as success when this URL is already registered.
 * On 409 (project subscription limit), removes subscriptions pointing at other URLs then retries once.
 */
export async function composioSubscribeTriggerWebhookResolvingLimits(
  apiKey: string,
  webhookUrl: string,
  purgeKeys: string[],
): Promise<ComposioWebhookSubscriptionResult> {
  const targetKey = webhookSubscriptionCompareKey(webhookUrl)

  const matchExisting = async (): Promise<ComposioWebhookSubscriptionResult | null> => {
    const subs = await listComposioWebhookSubscriptions(apiKey)
    const match = subs.find((s) => webhookSubscriptionCompareKey(s.webhook_url) === targetKey)
    return match ? { id: match.id, reusedExisting: true } : null
  }

  const reused = await matchExisting()
  if (reused) return reused

  try {
    return await composioSubscribeTriggerWebhook(apiKey, webhookUrl)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const is409 =
      msg.includes('failed (409)') ||
      msg.includes('ResourceLimitExceeded') ||
      msg.includes('WebhookSubscription_ResourceLimitExceeded')
    if (!is409) throw e

    const purge = await purgeNonMatchingWebhookSubscriptionsForKeys(purgeKeys, targetKey)
    if (purge.removed > 0) {
      console.info(
        `[composio-webhook] removed ${purge.removed} stale webhook subscription(s) via candidate API keys (max ${purge.maxListed} listed per key)`,
      )
    }

    const afterDelete = await matchExisting()
    if (afterDelete) return afterDelete

    try {
      return await composioSubscribeTriggerWebhook(apiKey, webhookUrl)
    } catch (e2) {
      const detail = e2 instanceof Error ? e2.message : String(e2)
      throw new Error(
        `${detail}\n\n` +
          `Your Composio project hit its webhook subscription cap. Remove unused webhooks in the Composio dashboard (Project → Webhooks), or align Pi / COMPOSIO_API_KEY / composio CLI (\`~/.composio/user_data.json\`) with the same Composio user, then click Register again.`,
      )
    }
  }
}

export async function composioSubscribeTriggerWebhookWithKeyFallback(
  settingsApiKey: string,
  webhookUrl: string,
): Promise<ComposioWebhookSubscriptionResult> {
  const keys = composioApiKeyCandidates(settingsApiKey)
  if (keys.length === 0) {
    throw new Error('No Composio API key: connect Composio in the Pi extension, run `composio login`, or set COMPOSIO_API_KEY.')
  }
  let lastErr: Error | undefined
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i]!
    try {
      return await composioSubscribeTriggerWebhookResolvingLimits(apiKey, webhookUrl, keys)
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      const unauthorized = isUnauthorizedComposioError(lastErr.message)
      const moreKeys = i < keys.length - 1
      if (!unauthorized || !moreKeys) throw lastErr
    }
  }
  throw lastErr ?? new Error('Composio webhook_subscriptions failed')
}
