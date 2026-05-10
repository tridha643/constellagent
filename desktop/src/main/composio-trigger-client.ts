/**
 * Minimal Composio REST client (trigger upsert) — avoids a heavyweight SDK dependency.
 * API: POST https://backend.composio.dev/api/v3.1/trigger_instances/{slug}/upsert
 */

import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3.1'

function isUnauthorizedComposioError(message: string): boolean {
  return message.includes('failed (401):') || message.includes('10401') || message.includes('HTTP_Unauthorized')
}

/** Same source as the Composio CLI (`composio` command) — usually `uak_…`. */
export function readComposioCliUserApiKey(): string | null {
  try {
    const p = join(homedir(), '.composio', 'user_data.json')
    const raw = readFileSync(p, 'utf8')
    const j = JSON.parse(raw) as { api_key?: unknown }
    return typeof j.api_key === 'string' && j.api_key.trim().length > 0 ? j.api_key.trim() : null
  } catch {
    return null
  }
}

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

export interface ComposioTriggerUpsertInput {
  apiKey: string
  slug: string
  connectedAccountId: string
  triggerConfig: Record<string, unknown>
}

export interface ComposioTriggerUpsertResult {
  triggerId: string
}

export async function composioTriggerUpsert(input: ComposioTriggerUpsertInput): Promise<ComposioTriggerUpsertResult> {
  const url = `${COMPOSIO_API_BASE}/trigger_instances/${encodeURIComponent(input.slug)}/upsert`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey.trim(),
    },
    body: JSON.stringify({
      connected_account_id: input.connectedAccountId,
      trigger_config: input.triggerConfig,
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Composio trigger upsert failed (${res.status}): ${text.slice(0, 500)}`)
  }
  if (res.status === 204) {
    throw new Error('Composio trigger upsert returned 204 — expected trigger_id')
  }
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    throw new Error(`Composio trigger upsert: invalid JSON body`)
  }
  const rec = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
  const id = typeof rec.trigger_id === 'string' ? rec.trigger_id : null
  if (!id) {
    throw new Error(`Composio trigger upsert: missing trigger_id in response`)
  }
  return { triggerId: id }
}

/**
 * Try UI/env API keys first; on 401 retry with the same key file the Composio CLI uses
 * (`~/.composio/user_data.json`), since `composio dev` / `composio triggers` does not use the
 * Automations text field.
 */
export async function composioTriggerUpsertWithCliFallback(input: ComposioTriggerUpsertInput): Promise<ComposioTriggerUpsertResult> {
  const keys = uniqueKeyOrder(input.apiKey, process.env.COMPOSIO_API_KEY, readComposioCliUserApiKey())
  if (keys.length === 0) {
    throw new Error('No Composio API key: connect Composio in the Pi extension, run `composio login`, or set COMPOSIO_API_KEY')
  }
  let lastErr: Error | undefined
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i]!
    try {
      return await composioTriggerUpsert({ ...input, apiKey })
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      const msg = lastErr.message
      const unauthorized = isUnauthorizedComposioError(msg)
      const moreKeys = i < keys.length - 1
      if (!unauthorized || !moreKeys) throw lastErr
    }
  }
  throw lastErr ?? new Error('Composio trigger upsert failed')
}

export interface ComposioGithubConnectedAccountRow {
  id: string
  user_id?: string
}

/** GET /connected_accounts — same auth chain as the CLI (`uak_…`). */
export async function composioListActiveGithubConnectedAccounts(
  apiKey: string,
): Promise<ComposioGithubConnectedAccountRow[]> {
  const url = new URL(`${COMPOSIO_API_BASE}/connected_accounts`)
  url.searchParams.set('toolkit_slugs', 'github')
  url.searchParams.set('statuses', 'ACTIVE')
  url.searchParams.set('limit', '50')
  const res = await fetch(url.toString(), {
    headers: { 'x-api-key': apiKey.trim() },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Composio list connected_accounts failed (${res.status}): ${text.slice(0, 500)}`)
  }
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    throw new Error('Composio connected_accounts: invalid JSON body')
  }
  const rec = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
  const items = rec.items
  if (!Array.isArray(items)) return []
  const out: ComposioGithubConnectedAccountRow[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    const user_id = typeof o.user_id === 'string' ? o.user_id : undefined
    if (id) out.push({ id, user_id })
  }
  return out
}

/** Prefer CLI default user_id (`default`), then `owner`, else first ACTIVE row. */
export function pickPreferredGithubConnectedAccountId(
  rows: readonly ComposioGithubConnectedAccountRow[],
): string | null {
  if (rows.length === 0) return null
  const rank = (uid: string | undefined): number => {
    if (uid === 'default') return 0
    if (uid === 'owner') return 1
    return 2
  }
  const sorted = [...rows].sort((a, b) => rank(a.user_id) - rank(b.user_id))
  return sorted[0]?.id ?? null
}

export async function composioSuggestGithubConnectedAccountId(settingsApiKeyField: string): Promise<string | null> {
  const keys = uniqueKeyOrder(settingsApiKeyField, process.env.COMPOSIO_API_KEY, readComposioCliUserApiKey())
  for (const apiKey of keys) {
    try {
      const rows = await composioListActiveGithubConnectedAccounts(apiKey)
      const id = pickPreferredGithubConnectedAccountId(rows)
      if (id) return id
    } catch {
      continue
    }
  }
  return null
}
