import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Cursor } from '@cursor/sdk'
import { parseCursorAgentListModelsOrThrow } from '../shared/cursor-cli-models'
import type { CursorModelCatalog } from '../shared/cursor-sdk-model'
import { cliEnvWithStandardPath } from './cli-env'
import { getCursorApiKey, resolveCursorAgentCli } from './conductor-auth'

const execFileAsync = promisify(execFile)
const CURSOR_MODEL_TIMEOUT_MS = 10_000
const CURSOR_MODEL_MAX_BUFFER = 1024 * 1024
const CATALOG_CACHE_MS = 60_000

const EMPTY_CATALOG: CursorModelCatalog = {
  cloudIds: new Set(),
  cloudAliases: new Set(),
  cliIds: new Set(),
}

let catalogCache: { at: number; catalog: CursorModelCatalog } | null = null

declare global {
  // eslint-disable-next-line no-var
  var __constellagentCursorBypassModelValidation: boolean | undefined
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase()
}

async function listCursorCliModelIds(): Promise<Set<string>> {
  const forcedStdout = process.env.CONSTELLAGENT_CURSOR_MODELS_STDOUT
  if (forcedStdout) {
    return new Set(parseCursorAgentListModelsOrThrow(forcedStdout))
  }

  const cli = resolveCursorAgentCli()
  if (!cli) return new Set()

  const env = cliEnvWithStandardPath()
  const opts = {
    env,
    timeout: CURSOR_MODEL_TIMEOUT_MS,
    maxBuffer: CURSOR_MODEL_MAX_BUFFER,
    encoding: 'utf8' as const,
  }

  const { stdout } = await execFileAsync(cli, ['--list-models'], opts)
  return new Set(parseCursorAgentListModelsOrThrow(stdout))
}

async function listCursorCloudModelCatalog(apiKey: string): Promise<Pick<CursorModelCatalog, 'cloudIds' | 'cloudAliases'>> {
  const cloudIds = new Set<string>()
  const cloudAliases = new Set<string>()

  try {
    const models = await Cursor.models.list({ apiKey })
    for (const model of models) {
      cloudIds.add(normalizeModelId(model.id))
      for (const alias of model.aliases ?? []) {
        cloudAliases.add(normalizeModelId(alias))
      }
    }
  } catch {
    // Fall back to CLI-only resolution when cloud catalog is unavailable.
  }

  return { cloudIds, cloudAliases }
}

export async function getCursorModelCatalog(force = false): Promise<CursorModelCatalog> {
  const now = Date.now()
  if (!force && catalogCache && now - catalogCache.at < CATALOG_CACHE_MS) {
    return catalogCache.catalog
  }

  const apiKey = getCursorApiKey()
  const [cliIds, cloudCatalog] = await Promise.all([
    listCursorCliModelIds().catch(() => new Set<string>()),
    apiKey ? listCursorCloudModelCatalog(apiKey) : Promise.resolve({ cloudIds: new Set<string>(), cloudAliases: new Set<string>() }),
  ])

  const catalog: CursorModelCatalog = {
    cloudIds: cloudCatalog.cloudIds,
    cloudAliases: cloudCatalog.cloudAliases,
    cliIds,
  }

  catalogCache = { at: now, catalog }
  return catalog
}

export function resetCursorModelCatalogCache(): void {
  catalogCache = null
}

export async function withCursorSdkModelValidationBypass<T>(bypass: boolean, fn: () => Promise<T>): Promise<T> {
  if (!bypass) return fn()

  const previous = globalThis.__constellagentCursorBypassModelValidation
  globalThis.__constellagentCursorBypassModelValidation = true

  try {
    return await fn()
  } finally {
    if (previous === undefined) {
      delete globalThis.__constellagentCursorBypassModelValidation
    } else {
      globalThis.__constellagentCursorBypassModelValidation = previous
    }
  }
}

export function emptyCursorModelCatalog(): CursorModelCatalog {
  return EMPTY_CATALOG
}
