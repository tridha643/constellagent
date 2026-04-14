import type { ModelPreset, PiModelOption } from './plan-build-command'

export const PI_MODEL_CACHE_VERSION = 3
export const PI_MODEL_CACHE_TTL_MS = 12 * 60 * 60 * 1000

const ANSI_ESCAPE_RE = /\u001B\[[0-9;]*m/g
const PI_TOKEN_RE = /^[a-z0-9][a-z0-9._-]*$/i
const PI_NO_MODELS_RE = /\b(no|0)\s+models?\b/i
const IGNORED_PI_LIST_LINE_PREFIXES = [
  'provider ',
  'available models',
  'models:',
  'listing models',
  'model catalog',
  'using ',
  'warning:',
  'error:',
  'info:',
  'hint:',
  'tip:',
]
const IGNORED_PI_LIST_TOKENS = new Set(['provider', 'model', 'models', 'name', 'id'])

export interface PiModelCacheRecord {
  version: number
  fetchedAt: number
  models: PiModelOption[]
}

export interface ResolvePiModelListOptions {
  readCache: () => Promise<unknown>
  writeCache: (record: PiModelCacheRecord) => Promise<void>
  fetchRuntimeModels: () => Promise<PiModelOption[]>
  now?: () => number
  cacheTtlMs?: number
}

export interface PiModelSelectState {
  presets: ModelPreset[]
  value: string
  hasSelectedPreset: boolean
}

function cleanPiListLine(rawLine: string): string {
  return rawLine.replace(ANSI_ESCAPE_RE, '').trim()
}

function isIgnoredPiListLine(line: string): boolean {
  if (!line) return true
  if (/^[-=]{3,}$/.test(line)) return true
  const normalized = line.replace(/\s+/g, ' ').toLowerCase()
  return IGNORED_PI_LIST_LINE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

function normalizePiModelOption(model: PiModelOption): PiModelOption | null {
  const provider = typeof model.provider === 'string' ? model.provider.trim() : ''
  const optionModel = typeof model.model === 'string' ? model.model.trim() : ''
  const optionId = typeof model.id === 'string' ? model.id.trim() : ''
  const id = optionId || (provider && optionModel ? `${provider}/${optionModel}` : '')

  if (!provider || !optionModel || !id) return null
  if (!PI_TOKEN_RE.test(provider) || !PI_TOKEN_RE.test(optionModel)) return null
  if (id !== `${provider}/${optionModel}`) return null

  return { provider, model: optionModel, id }
}

function extractPiModelTokens(line: string): { provider: string; model: string } | null {
  const cells = line.startsWith('|')
    ? line
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
    : null

  const candidates = cells && cells.length >= 2
    ? [[cells[0], cells[1]]]
    : [line.split(/\s+/, 3) as [string?, string?]]

  for (const [provider, model] of candidates) {
    if (!provider || !model) continue
    if (!PI_TOKEN_RE.test(provider) || !PI_TOKEN_RE.test(model)) continue
    if (IGNORED_PI_LIST_TOKENS.has(provider.toLowerCase())) continue
    if (IGNORED_PI_LIST_TOKENS.has(model.toLowerCase())) continue
    return { provider, model }
  }

  const providerQualifiedMatch = line.match(/\b([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)\b/i)
  if (!providerQualifiedMatch) return null

  return {
    provider: providerQualifiedMatch[1],
    model: providerQualifiedMatch[2],
  }
}

export function normalizePiModelOptions(models: readonly PiModelOption[]): PiModelOption[] {
  const out: PiModelOption[] = []
  const seen = new Set<string>()

  for (const model of models) {
    const normalized = normalizePiModelOption(model)
    if (!normalized || seen.has(normalized.id)) continue
    seen.add(normalized.id)
    out.push(normalized)
  }

  return out
}

export function normalizePiModelCache(value: unknown): PiModelCacheRecord | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Partial<PiModelCacheRecord>
  if (record.version !== PI_MODEL_CACHE_VERSION) return null
  if (typeof record.fetchedAt !== 'number' || !Number.isFinite(record.fetchedAt) || record.fetchedAt <= 0) {
    return null
  }

  const models = Array.isArray(record.models) ? normalizePiModelOptions(record.models) : null
  if (!models) return null

  return {
    version: PI_MODEL_CACHE_VERSION,
    fetchedAt: record.fetchedAt,
    models,
  }
}

export function isPiModelCacheFresh(
  fetchedAt: number,
  now = Date.now(),
  ttlMs = PI_MODEL_CACHE_TTL_MS,
): boolean {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return false
  return now - fetchedAt < ttlMs
}

export function parsePiListModels(stdout: string): PiModelOption[] {
  const out: PiModelOption[] = []
  const seen = new Set<string>()

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = cleanPiListLine(rawLine)
    if (isIgnoredPiListLine(line)) continue

    const tokens = extractPiModelTokens(line)
    if (!tokens) continue

    const id = `${tokens.provider}/${tokens.model}`
    if (seen.has(id)) continue

    seen.add(id)
    out.push({ provider: tokens.provider, model: tokens.model, id })
  }

  return out
}

export function parsePiListModelsOrThrow(stdout: string): PiModelOption[] {
  const models = parsePiListModels(stdout)
  if (models.length > 0) return models

  const cleanedLines = stdout
    .split(/\r?\n/)
    .map(cleanPiListLine)
    .filter((line) => line.length > 0)

  if (cleanedLines.length === 0) return []
  if (cleanedLines.some((line) => PI_NO_MODELS_RE.test(line))) return []
  throw new Error('Unable to parse `pi --list-models` output')
}

export function formatPiModelOptionLabel(model: PiModelOption): string {
  return `${model.provider} / ${model.model}`
}

function canonicalPiModelId(stored: string | null): string {
  if (!stored) return ''

  const trimmed = stored.trim()
  if (!trimmed) return ''

  const providerQualifiedMatch = trimmed.match(/^([a-z0-9][a-z0-9._-]*)\s*\/\s*([a-z0-9][a-z0-9._-]*)$/i)
  if (!providerQualifiedMatch) return trimmed

  return `${providerQualifiedMatch[1].toLowerCase()}/${providerQualifiedMatch[2].toLowerCase()}`
}

export function resolvePiModelSelectState(
  models: readonly PiModelOption[],
  stored: string | null,
): PiModelSelectState {
  const presets = normalizePiModelOptions(models).map((model) => ({
    label: formatPiModelOptionLabel(model),
    cliModel: model.id,
  }))
  const value = canonicalPiModelId(stored)

  return {
    presets,
    value,
    hasSelectedPreset: !!value && presets.some((preset) => preset.cliModel === value),
  }
}

export async function resolvePiModelList({
  readCache,
  writeCache,
  fetchRuntimeModels,
  now = () => Date.now(),
  cacheTtlMs = PI_MODEL_CACHE_TTL_MS,
}: ResolvePiModelListOptions): Promise<PiModelOption[]> {
  const currentTime = now()
  const cache = normalizePiModelCache(await readCache())

  if (cache && isPiModelCacheFresh(cache.fetchedAt, currentTime, cacheTtlMs)) {
    return cache.models
  }

  try {
    const models = normalizePiModelOptions(await fetchRuntimeModels())
    try {
      await writeCache({
        version: PI_MODEL_CACHE_VERSION,
        fetchedAt: currentTime,
        models,
      })
    } catch {
      // A cache write failure should not block the UI from using the fresh result.
    }
    return models
  } catch (error) {
    if (cache) return cache.models
    throw error
  }
}
