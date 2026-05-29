import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ConductorAuthStatus } from '../shared/agent-chat-types'
import { resetCursorModelCatalogCache } from './cursor-model-catalog'
import { cliEnvWithStandardPath } from './cli-env'

const execFileAsync = promisify(execFile)

let cursorApiKeyFromSettings = ''
let openaiApiKeyFromSettings = ''

export interface CursorCliAuthSnapshot {
  authenticated: boolean
  email?: string
}

let cliAuthCache: { at: number; snapshot: CursorCliAuthSnapshot } | null = null
const CLI_AUTH_CACHE_MS = 5000

export function invalidateCursorCliAuthCache(): void {
  cliAuthCache = null
}

export function setConductorAuthKeys(cursorApiKey: string, openaiApiKey: string): void {
  cursorApiKeyFromSettings = cursorApiKey.trim()
  openaiApiKeyFromSettings = openaiApiKey.trim()
  invalidateCursorCliAuthCache()
  resetCursorModelCatalogCache()
}

export function applyConductorAuthFromPersistedState(data: unknown): void {
  const settings = (data as { settings?: Record<string, unknown> } | null)?.settings
  if (!settings) return
  setConductorAuthKeys(
    typeof settings.conductorCursorApiKey === 'string' ? settings.conductorCursorApiKey : '',
    typeof settings.conductorOpenaiApiKey === 'string' ? settings.conductorOpenaiApiKey : '',
  )
}

function cursorAgentCliCandidates(): string[] {
  return [
    'cursor-agent',
    'agent',
    join(homedir(), '.local', 'bin', 'cursor-agent'),
    join(homedir(), '.local', 'bin', 'agent'),
  ]
}

function firstLine(out: string): string | undefined {
  return out.trim().split(/\r?\n/)[0]?.trim() || undefined
}

/** Resolve cursor-agent on PATH (GUI Electron often omits ~/.local/bin without cli-env). */
export function resolveCursorAgentCli(): string | undefined {
  const env = cliEnvWithStandardPath()
  for (const bin of cursorAgentCliCandidates()) {
    if (bin.includes('/') && existsSync(bin)) return bin
    try {
      const lookup = process.platform === 'win32' ? 'where' : 'which'
      const out = execFileSync(lookup, [bin], { encoding: 'utf8', env, timeout: 5000 })
      const line = firstLine(out)
      if (line) return line
    } catch {
      // try next candidate
    }
  }
  return undefined
}

/** Async twin of {@link resolveCursorAgentCli} — used by the polled auth-status path so the
 *  CLI lookup never blocks the main thread's event loop. */
async function resolveCursorAgentCliAsync(): Promise<string | undefined> {
  const env = cliEnvWithStandardPath()
  for (const bin of cursorAgentCliCandidates()) {
    if (bin.includes('/') && existsSync(bin)) return bin
    try {
      const lookup = process.platform === 'win32' ? 'where' : 'which'
      const { stdout } = await execFileAsync(lookup, [bin], { encoding: 'utf8', env, timeout: 5000 })
      const line = firstLine(stdout)
      if (line) return line
    } catch {
      // try next candidate
    }
  }
  return undefined
}

export function parseCursorCliAuthJson(raw: string): CursorCliAuthSnapshot {
  try {
    const parsed = JSON.parse(raw) as {
      isAuthenticated?: boolean
      status?: string
      userInfo?: { email?: string }
    }
    const authenticated =
      parsed.isAuthenticated === true || parsed.status === 'authenticated'
    return {
      authenticated,
      email: typeof parsed.userInfo?.email === 'string' ? parsed.userInfo.email : undefined,
    }
  } catch {
    return { authenticated: false }
  }
}

export function getCursorCliAuthSnapshot(force = false): CursorCliAuthSnapshot {
  const now = Date.now()
  if (!force && cliAuthCache && now - cliAuthCache.at < CLI_AUTH_CACHE_MS) {
    return cliAuthCache.snapshot
  }

  const cli = resolveCursorAgentCli()
  if (!cli) {
    const snapshot = { authenticated: false }
    cliAuthCache = { at: now, snapshot }
    return snapshot
  }

  try {
    const out = execFileSync(cli, ['status', '--format', 'json'], {
      encoding: 'utf8',
      env: cliEnvWithStandardPath(),
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const snapshot = parseCursorCliAuthJson(out)
    cliAuthCache = { at: now, snapshot }
    return snapshot
  } catch {
    const snapshot = { authenticated: false }
    cliAuthCache = { at: now, snapshot }
    return snapshot
  }
}

/** Non-blocking twin of {@link getCursorCliAuthSnapshot}. Shares the same cache, so a refresh
 *  here also warms the synchronous reads used in-turn by the Cursor driver. The IPC auth-status
 *  path (Settings polls this every 2s with force=true during sign-in) goes through here so the
 *  15s `cursor-agent status` timeout never freezes the main process. */
export async function getCursorCliAuthSnapshotAsync(force = false): Promise<CursorCliAuthSnapshot> {
  const now = Date.now()
  if (!force && cliAuthCache && now - cliAuthCache.at < CLI_AUTH_CACHE_MS) {
    return cliAuthCache.snapshot
  }

  const cli = await resolveCursorAgentCliAsync()
  if (!cli) {
    const snapshot = { authenticated: false }
    cliAuthCache = { at: now, snapshot }
    return snapshot
  }

  try {
    const { stdout } = await execFileAsync(cli, ['status', '--format', 'json'], {
      encoding: 'utf8',
      env: cliEnvWithStandardPath(),
      timeout: 15_000,
    })
    const snapshot = parseCursorCliAuthJson(stdout)
    cliAuthCache = { at: now, snapshot }
    return snapshot
  } catch {
    const snapshot = { authenticated: false }
    cliAuthCache = { at: now, snapshot }
    return snapshot
  }
}

export function hasCursorCliLogin(): boolean {
  return getCursorCliAuthSnapshot().authenticated
}

/** Cursor cloud API keys are optional for local Conductor chat when cursor-agent is authenticated. */
export const CURSOR_SDK_API_KEY_MESSAGE =
  'Cursor is not signed in. Run `cursor-agent login` in a terminal or add your API key in Settings → Conductor.'

export function getCursorApiKey(): string | undefined {
  const fromSettings = cursorApiKeyFromSettings
  if (fromSettings) return fromSettings
  const fromEnv = process.env.CURSOR_API_KEY?.trim()
  return fromEnv || undefined
}

export function getOpenaiApiKey(): string | undefined {
  const fromSettings = openaiApiKeyFromSettings
  if (fromSettings) return fromSettings
  const fromEnv = process.env.OPENAI_API_KEY?.trim()
  return fromEnv || undefined
}

export function hasCodexCliLogin(): boolean {
  return existsSync(join(homedir(), '.codex', 'auth.json'))
}

export function cursorAuthMessageForState(hasApiKey: boolean, hasCliLogin: boolean): string | null {
  if (hasApiKey || hasCliLogin) return null
  return CURSOR_SDK_API_KEY_MESSAGE
}

export function checkCursorAuth(): string | null {
  return cursorAuthMessageForState(Boolean(getCursorApiKey()), hasCursorCliLogin())
}

export function checkCodexAuth(): string | null {
  if (getOpenaiApiKey()) return null
  if (hasCodexCliLogin()) return null
  return 'Codex is not signed in. Run `codex login` in a terminal or add an OpenAI API key in Settings → Conductor.'
}

export async function getConductorAuthStatus(forceRefresh = false): Promise<ConductorAuthStatus> {
  const cursorKey = getCursorApiKey()
  const cliAuth = await getCursorCliAuthSnapshotAsync(forceRefresh)
  const openaiKey = getOpenaiApiKey()
  const codexLogin = hasCodexCliLogin()

  const cliDetail = cliAuth.authenticated
    ? `Signed in via \`cursor-agent login\`${cliAuth.email ? ` (${cliAuth.email})` : ''}`
    : undefined

  return {
    cursor: {
      ready: Boolean(cursorKey || cliAuth.authenticated),
      detail: cursorKey
        ? 'API key configured'
        : cliDetail ??
          'Run `cursor-agent login` in a terminal or add a Cursor API key in Settings → Conductor.',
    },
    codex: {
      ready: Boolean(openaiKey || codexLogin),
      detail: openaiKey
        ? 'OpenAI API key configured'
        : codexLogin
          ? 'Signed in via `codex login`'
          : 'Run `codex login` in a terminal or add an OpenAI API key in Settings → Conductor.',
    },
    pi: {
      ready: true,
      detail: 'Uses Pi SDK runtime configuration.',
    },
  }
}
