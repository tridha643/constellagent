import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Extra PATH segments prepended for subprocess CLIs. GUI-launched Electron on macOS
 * often omits Homebrew, nvm, and ~/.local/bin, so `execFile('pi', …)` would miss the real binary.
 */
const CLI_PATH_PREFIXES: readonly string[] = [
  join(homedir(), '.local', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

let darwinLoginPathMemo: string | null | undefined

/** One-shot PATH from a login zsh (picks up nvm/fnm/etc. not in the GUI environment). */
function darwinLoginPathSegment(): string | null {
  if (process.env.CONSTELLAGENT_SKIP_LOGIN_PATH === '1') return null
  if (darwinLoginPathMemo !== undefined) return darwinLoginPathMemo
  if (process.platform !== 'darwin') {
    darwinLoginPathMemo = null
    return null
  }
  try {
    const out = execFileSync('/bin/zsh', ['-l', '-c', 'printf %s "$PATH"'], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, HOME: homedir() },
    })
    const trimmed = out.trim()
    darwinLoginPathMemo = trimmed.length > 0 ? trimmed : null
  } catch {
    darwinLoginPathMemo = null
  }
  return darwinLoginPathMemo
}

function dedupePathEntries(pathValue: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of pathValue.split(':')) {
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }
  return out.join(':')
}

/** PATH with login-shell + standard CLI install locations prepended (first match wins). */
export function pathWithStandardCliPrefixes(): string {
  const existing = process.env.PATH ?? ''
  const login = darwinLoginPathSegment()
  return dedupePathEntries([login, ...CLI_PATH_PREFIXES, existing].filter((p): p is string => !!p && p.length > 0).join(':'))
}

/** `process.env` copy with PATH suitable for spawning user-installed CLIs from the main process. */
export function cliEnvWithStandardPath(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: pathWithStandardCliPrefixes(),
  } as NodeJS.ProcessEnv
}
