import { existsSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import type {
  ComposioAutomationAgent,
  ComposioAutomationDefinition,
  ComposioAutomationFileEntry,
} from '../../shared/composio-types'
import { isComposioAutomationAgent } from '../../shared/composio-types'
import { listPersistedProjectsWithBranches } from '../persisted-state'

const DEFAULT_AGENT: ComposioAutomationAgent = 'claude-code'

/**
 * Pi CLI / extension shared store: `~/.config/pi/composio-automations.json` (e.g. `/Users/…/.config/pi/…`).
 * Override with `PI_COMPOSIO_AUTOMATIONS_JSON` if needed.
 */
export function globalComposioAutomationsPath(): string {
  const fromEnv = process.env.PI_COMPOSIO_AUTOMATIONS_JSON?.trim()
  if (fromEnv) return resolve(fromEnv)
  return join(homedir(), '.config', 'pi', 'composio-automations.json')
}

function repoPathHintFromRaw(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const metadata = isRecord(raw.metadata) ? raw.metadata : {}
  const workspaceFromTopLevel = typeof raw.workspace === 'string' ? raw.workspace.trim() : ''
  const workspaceFromMetadata = typeof metadata.workspace === 'string' ? metadata.workspace.trim() : ''
  /** Composio CLI `~/.composio/automations.json` often sets this to an absolute clone path. */
  const repoPathFromMetadata = typeof metadata.repoPath === 'string' ? metadata.repoPath.trim() : ''
  const w = workspaceFromTopLevel || workspaceFromMetadata || repoPathFromMetadata
  return w.length > 0 ? w : null
}

/** Pi saves `metadata.repo` as `owner/repo` without a filesystem `workspace`. */
function piMetadataRepoSlug(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const metadata = isRecord(raw.metadata) ? raw.metadata : {}
  const r = typeof metadata.repo === 'string' ? metadata.repo.trim() : ''
  if (!r) return null
  return r.toLowerCase()
}

function repoNameFromPiSlug(piSlug: string): string {
  const idx = piSlug.lastIndexOf('/')
  return (idx >= 0 ? piSlug.slice(idx + 1) : piSlug).toLowerCase()
}

/**
 * Resolve a on-disk repo path for an automation row: `workspace` / `metadata.workspace` / `metadata.repoPath`,
 * else match `metadata.repo` (`owner/repo` or bare repo name) against folder name(s) in the path pool.
 *
 * @param repoPathsFilter `null` → all persisted projects; otherwise only these paths (e.g. open tabs).
 */
function resolveNormRepoForEntry(entry: unknown, repoPathsFilter: readonly string[] | null): string | null {
  const hint = repoPathHintFromRaw(entry)
  if (hint) return resolve(hint)

  const piSlug = piMetadataRepoSlug(entry)
  if (!piSlug) return null

  const wantDir = repoNameFromPiSlug(piSlug)
  const pool: string[] =
    repoPathsFilter === null
      ? listPersistedProjectsWithBranches().map((p) => resolve(p.repoPath))
      : Array.from(new Set(repoPathsFilter.map((p) => resolve(p))))
  const matches = pool.filter((p) => basename(p).toLowerCase() === wantDir)
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]!

  const owner = piSlug.includes('/') ? piSlug.slice(0, piSlug.indexOf('/')) : ''
  if (owner) {
    const narrowed = matches.filter((p) => p.toLowerCase().includes(owner))
    if (narrowed.length === 1) return narrowed[0]!
  }
  return matches[0]!
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stableId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96) || 'composio-automation'
}

function normalizeAgent(value: unknown): ComposioAutomationAgent {
  return isComposioAutomationAgent(value) ? value : DEFAULT_AGENT
}

function entryIdentity(entry: ComposioAutomationFileEntry): string {
  return entry.id || entry.name || entry.triggerId || entry.triggerSlug
}

function normalizeEntry(
  raw: unknown,
  repoPath: string,
  filePath: string,
): ComposioAutomationDefinition | null {
  if (!isRecord(raw)) return null
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : typeof raw.triggerSlug === 'string'
      ? raw.triggerSlug.trim()
      : ''
  const triggerId = typeof raw.triggerId === 'string' ? raw.triggerId.trim() : ''
  const triggerSlug = typeof raw.triggerSlug === 'string' ? raw.triggerSlug.trim() : ''
  const instructions = typeof raw.instructions === 'string' ? raw.instructions : ''
  if (!name || (!triggerId && !triggerSlug)) return null

  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id.trim()
    : stableId(`${name}-${triggerId || triggerSlug}`)
  const metadata = isRecord(raw.metadata) ? raw.metadata : {}
  const workspaceFromTopLevel = typeof raw.workspace === 'string' ? raw.workspace.trim() : ''
  const workspaceFromMetadata = typeof metadata.workspace === 'string' ? metadata.workspace.trim() : ''

  return {
    id,
    name,
    triggerId,
    triggerSlug,
    instructions,
    enabled: raw.enabled !== false,
    agent: normalizeAgent(raw.agent ?? metadata.agent),
    workspace: workspaceFromTopLevel || workspaceFromMetadata || repoPath,
    repoPath,
    filePath,
    metadata,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  }
}

async function readRawEntries(filePath: string): Promise<ComposioAutomationFileEntry[]> {
  if (!existsSync(filePath)) return []
  const text = await readFile(filePath, 'utf-8')
  if (!text.trim()) return []
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isRecord) as ComposioAutomationFileEntry[]
}

async function writeRawEntries(filePath: string, entries: ComposioAutomationFileEntry[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmpPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8')
  await rename(tmpPath, filePath)
}

async function resolveMutationTarget(input: {
  repoPath: string
  id: string
}): Promise<{
  filePath: string
  entries: ComposioAutomationFileEntry[]
  normalizeRepoPath: string
} | null> {
  const globalPath = globalComposioAutomationsPath()
  let globalEntries: ComposioAutomationFileEntry[]
  try {
    globalEntries = await readRawEntries(globalPath)
  } catch {
    return null
  }
  for (const entry of globalEntries) {
    const normRepo =
      resolveNormRepoForEntry(entry, [input.repoPath]) ?? resolveNormRepoForEntry(entry, null)
    if (!normRepo) continue
    const normalized = normalizeEntry(entry, normRepo, globalPath)
    if (normalized && (normalized.id === input.id || entryIdentity(entry) === input.id)) {
      return { filePath: globalPath, entries: globalEntries, normalizeRepoPath: normRepo }
    }
  }
  return null
}

export async function listComposioAutomationDefinitions(
  repoPaths?: readonly string[],
): Promise<ComposioAutomationDefinition[]> {
  const globalPath = globalComposioAutomationsPath()
  const definitions: ComposioAutomationDefinition[] = []
  const allowedRepos =
    repoPaths === undefined
      ? null
      : new Set(Array.from(new Set(repoPaths.map((p) => resolve(p)))))
  const poolFilter = repoPaths === undefined ? null : repoPaths

  try {
    const entries = await readRawEntries(globalPath)
    for (const entry of entries) {
      const normRepo = resolveNormRepoForEntry(entry, poolFilter)
      if (!normRepo) {
        console.warn('[composio-automations] skipping entry: add workspace or metadata.repo matching a project folder', {
          globalPath,
          name: isRecord(entry) && typeof entry.name === 'string' ? entry.name : undefined,
        })
        continue
      }
      if (allowedRepos && !allowedRepos.has(normRepo)) continue
      const normalized = normalizeEntry(entry, normRepo, globalPath)
      if (normalized) definitions.push(normalized)
    }
  } catch (err) {
    console.warn('[composio-automations] failed to read definitions', { globalPath, err })
  }

  return definitions.sort((a, b) => a.name.localeCompare(b.name))
}

export async function setComposioAutomationDefinitionEnabled(input: {
  repoPath: string
  id: string
  enabled: boolean
}): Promise<ComposioAutomationDefinition> {
  const resolved = await resolveMutationTarget({ repoPath: input.repoPath, id: input.id })
  if (!resolved) {
    throw new Error(`Composio automation not found: ${input.id}`)
  }
  const { filePath, entries, normalizeRepoPath } = resolved
  let updated: ComposioAutomationDefinition | null = null

  const next = entries.map((entry) => {
    const normalized = normalizeEntry(entry, normalizeRepoPath, filePath)
    const matches = normalized?.id === input.id || entryIdentity(entry) === input.id
    if (!matches) return entry
    const changed = {
      ...entry,
      enabled: input.enabled,
      updatedAt: new Date().toISOString(),
    }
    updated = normalizeEntry(changed, normalizeRepoPath, filePath)
    return changed
  })

  if (!updated) {
    throw new Error(`Composio automation not found: ${input.id}`)
  }

  await writeRawEntries(filePath, next)
  return updated
}

export async function setComposioAutomationDefinitionInstructions(input: {
  repoPath: string
  id: string
  instructions: string
}): Promise<ComposioAutomationDefinition> {
  const resolved = await resolveMutationTarget({ repoPath: input.repoPath, id: input.id })
  if (!resolved) {
    throw new Error(`Composio automation not found: ${input.id}`)
  }
  const { filePath, entries, normalizeRepoPath } = resolved
  let updated: ComposioAutomationDefinition | null = null

  const next = entries.map((entry) => {
    const normalized = normalizeEntry(entry, normalizeRepoPath, filePath)
    const matches = normalized?.id === input.id || entryIdentity(entry) === input.id
    if (!matches) return entry
    const changed = {
      ...entry,
      instructions: input.instructions,
      updatedAt: new Date().toISOString(),
    }
    updated = normalizeEntry(changed, normalizeRepoPath, filePath)
    return changed
  })

  if (!updated) {
    throw new Error(`Composio automation not found: ${input.id}`)
  }

  await writeRawEntries(filePath, next)
  return updated
}

export async function setComposioAutomationDefinitionAgent(input: {
  repoPath: string
  id: string
  agent: ComposioAutomationAgent
}): Promise<ComposioAutomationDefinition> {
  const resolved = await resolveMutationTarget({ repoPath: input.repoPath, id: input.id })
  if (!resolved) {
    throw new Error(`Composio automation not found: ${input.id}`)
  }
  const { filePath, entries, normalizeRepoPath } = resolved
  let updated: ComposioAutomationDefinition | null = null

  const next = entries.map((entry) => {
    const normalized = normalizeEntry(entry, normalizeRepoPath, filePath)
    const matches = normalized?.id === input.id || entryIdentity(entry) === input.id
    if (!matches) return entry
    const changed: ComposioAutomationFileEntry = {
      ...entry,
      agent: input.agent,
      updatedAt: new Date().toISOString(),
    }
    updated = normalizeEntry(changed, normalizeRepoPath, filePath)
    return changed
  })

  if (!updated) {
    throw new Error(`Composio automation not found: ${input.id}`)
  }

  await writeRawEntries(filePath, next)
  return updated
}
