import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ConductorAuthStatus } from '../shared/agent-chat-types'
import { cliEnvWithStandardPath } from './cli-env'

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
}

export function applyConductorAuthFromPersistedState(data: unknown): void {
  const settings = (data as { settings?: Record<string, unknown> } | null)?.settings
  if (!settings) return
  setConductorAuthKeys(
    typeof settings.conductorCursorApiKey === 'string' ? settings.conductorCursorApiKey : '',
    typeof settings.conductorOpenaiApiKey === 'string' ? settings.conductorOpenaiApiKey : '',
  )
}

/** Resolve cursor-agent on PATH (GUI Electron often omits ~/.local/bin without cli-env). */
export function resolveCursorAgentCli(): string | undefined {
  const env = cliEnvWithStandardPath()
  const candidates = [
    'cursor-agent',
    'agent',
    join(homedir(), '.local', 'bin', 'cursor-agent'),
    join(homedir(), '.local', 'bin', 'agent'),
  ]
  for (const bin of candidates) {
    if (bin.includes('/') && existsSync(bin)) return bin
    try {
      const lookup = process.platform === 'win32' ? 'where' : 'which'
      const out = execFileSync(lookup, [bin], { encoding: 'utf8', env, timeout: 5000 })
      const line = out.trim().split(/\r?\n/)[0]?.trim()
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

export function hasCursorCliLogin(): boolean {
  return getCursorCliAuthSnapshot().authenticated
}

/** Conductor chat uses @cursor/sdk, which requires an API key — not cursor-agent OAuth alone. */
export const CURSOR_SDK_API_KEY_MESSAGE =
  'Conductor chat uses the Cursor SDK and needs an API key (Settings → Conductor or CURSOR_API_KEY). cursor-agent login signs in the CLI only.'

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

export function checkCursorAuth(): string | null {
  if (getCursorApiKey()) return null
  if (hasCursorCliLogin()) return CURSOR_SDK_API_KEY_MESSAGE
  return 'Cursor is not signed in. Run `cursor-agent login` in a terminal or add your API key in Settings → Conductor.'
}

export function checkCodexAuth(): string | null {
  if (getOpenaiApiKey()) return null
  if (hasCodexCliLogin()) return null
  return 'Codex is not signed in. Run `codex login` in a terminal or add an OpenAI API key in Settings → Conductor.'
}

export function getConductorAuthStatus(forceRefresh = false): ConductorAuthStatus {
  const cursorKey = getCursorApiKey()
  const cliAuth = getCursorCliAuthSnapshot(forceRefresh)
  const openaiKey = getOpenaiApiKey()
  const codexLogin = hasCodexCliLogin()

  const cliDetail = cliAuth.authenticated
    ? `Signed in to cursor-agent${cliAuth.email ? ` (${cliAuth.email})` : ''} — add an API key below for Conductor chat`
    : undefined

  return {
    cursor: {
      ready: Boolean(cursorKey),
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
  }
}
