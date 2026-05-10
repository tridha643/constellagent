import { existsSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import type {
  ComposioAutomationAgent,
  ComposioAutomationDefinition,
  ComposioAutomationFileEntry,
} from '../../shared/composio-types'
import { listPersistedProjectsWithBranches } from '../persisted-state'

const AUTOMATIONS_RELATIVE_PATH = join('.composio', 'automations.json')
const DEFAULT_AGENT: ComposioAutomationAgent = 'claude-code'

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
  switch (value) {
    case 'claude-code':
    case 'codex':
    case 'gemini':
    case 'cursor':
    case 'opencode':
    case 'pi-constell':
      return value
    default:
      return DEFAULT_AGENT
  }
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

export function composioAutomationsPath(repoPath: string): string {
  return join(resolve(repoPath), AUTOMATIONS_RELATIVE_PATH)
}

export async function listComposioAutomationDefinitions(
  repoPaths?: readonly string[],
): Promise<ComposioAutomationDefinition[]> {
  const candidates = repoPaths?.length
    ? repoPaths
    : listPersistedProjectsWithBranches().map((project) => project.repoPath)
  const uniqueRepoPaths = Array.from(new Set(candidates.map((repoPath) => resolve(repoPath))))
  const definitions: ComposioAutomationDefinition[] = []

  for (const repoPath of uniqueRepoPaths) {
    const filePath = composioAutomationsPath(repoPath)
    let entries: ComposioAutomationFileEntry[]
    try {
      entries = await readRawEntries(filePath)
    } catch (err) {
      console.warn('[composio-automations] failed to read definitions', { filePath, err })
      continue
    }
    for (const entry of entries) {
      const normalized = normalizeEntry(entry, repoPath, filePath)
      if (normalized) definitions.push(normalized)
    }
  }

  return definitions.sort((a, b) => a.name.localeCompare(b.name))
}

export async function setComposioAutomationDefinitionEnabled(input: {
  repoPath: string
  id: string
  enabled: boolean
}): Promise<ComposioAutomationDefinition> {
  const repoPath = resolve(input.repoPath)
  const filePath = composioAutomationsPath(repoPath)
  const entries = await readRawEntries(filePath)
  let updated: ComposioAutomationDefinition | null = null

  const next = entries.map((entry) => {
    const normalized = normalizeEntry(entry, repoPath, filePath)
    const matches = normalized?.id === input.id || entryIdentity(entry) === input.id
    if (!matches) return entry
    const changed = {
      ...entry,
      enabled: input.enabled,
      updatedAt: new Date().toISOString(),
    }
    updated = normalizeEntry(changed, repoPath, filePath)
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
  const repoPath = resolve(input.repoPath)
  const filePath = composioAutomationsPath(repoPath)
  const entries = await readRawEntries(filePath)
  let updated: ComposioAutomationDefinition | null = null

  const next = entries.map((entry) => {
    const normalized = normalizeEntry(entry, repoPath, filePath)
    const matches = normalized?.id === input.id || entryIdentity(entry) === input.id
    if (!matches) return entry
    const changed = {
      ...entry,
      instructions: input.instructions,
      updatedAt: new Date().toISOString(),
    }
    updated = normalizeEntry(changed, repoPath, filePath)
    return changed
  })

  if (!updated) {
    throw new Error(`Composio automation not found: ${input.id}`)
  }

  await writeRawEntries(filePath, next)
  return updated
}
