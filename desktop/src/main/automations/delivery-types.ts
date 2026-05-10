export interface AutomationDelivery {
  provider: 'composio'
  receivedAt: number
  payload: unknown
  triggerIds: string[]
  triggerSlugs: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const TRIGGER_ID_KEYS = new Set([
  'triggerId',
  'trigger_id',
  'triggerInstanceId',
  'trigger_instance_id',
  'triggerInstanceID',
  'trigger_id_value',
  'id',
])

const TRIGGER_SLUG_KEYS = new Set([
  'triggerSlug',
  'trigger_slug',
  'triggerName',
  'trigger_name',
  'slug',
  'event',
  'event_type',
])

function addToken(out: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (trimmed) out.add(trimmed)
}

function walk(value: unknown, ids: Set<string>, slugs: Set<string>, depth = 0): void {
  if (depth > 8) return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, ids, slugs, depth + 1)
    return
  }
  if (!isRecord(value)) return

  for (const [key, child] of Object.entries(value)) {
    if (TRIGGER_ID_KEYS.has(key)) addToken(ids, child)
    if (TRIGGER_SLUG_KEYS.has(key)) addToken(slugs, child)
    walk(child, ids, slugs, depth + 1)
  }
}

export function composioDeliveryFromPayload(payload: unknown): AutomationDelivery {
  const triggerIds = new Set<string>()
  const triggerSlugs = new Set<string>()
  walk(payload, triggerIds, triggerSlugs)

  return {
    provider: 'composio',
    receivedAt: Date.now(),
    payload,
    triggerIds: Array.from(triggerIds),
    triggerSlugs: Array.from(triggerSlugs),
  }
}
