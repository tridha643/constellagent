import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Extra PATH segments prepended for subprocess CLIs. GUI-launched Electron on macOS
 * often omits Homebrew, nvm, and ~/.local/bin, so `execFile('pi', …)` would miss the real binary.
 */
const CLI_PATH_PREFIXES: readonly string[] = [
  join(homedir(), '.bun', 'bin'),
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

/**
 * Drop `node_modules/.bin` entries from a PATH string. When the app is launched
 * via a package manager (`bun run dev` → `bun run --cwd desktop dev`), bun
 * prepends the package's `node_modules/.bin` to PATH. Electron inherits it, and
 * so does every CLI we spawn — so a bundled dependency (e.g. `pi`) shadows the
 * user's global install, breaking `pi update`, version pinning, etc. Removing
 * these entries makes spawned CLIs resolve the global binary. `npm run` / `bunx`
 * still inject a project's local `.bin` at invocation time, so this does not
 * affect those.
 */
export function stripNodeModulesBin(pathValue: string): string {
  return pathValue
    .split(':')
    .filter((entry) => {
      const normalized = entry.replace(/\\/g, '/').replace(/\/+$/, '')
      return !normalized.endsWith('/node_modules/.bin')
    })
    .join(':')
}

/** PATH with login-shell + standard CLI install locations prepended (first match wins), minus any leaked `node_modules/.bin`. */
export function pathWithStandardCliPrefixes(): string {
  const existing = stripNodeModulesBin(process.env.PATH ?? '')
  const login = darwinLoginPathSegment()
  const loginClean = login ? stripNodeModulesBin(login) : login
  return dedupePathEntries([loginClean, ...CLI_PATH_PREFIXES, existing].filter((p): p is string => !!p && p.length > 0).join(':'))
}

/** `process.env` copy with PATH suitable for spawning user-installed CLIs from the main process. */
export function cliEnvWithStandardPath(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: pathWithStandardCliPrefixes(),
  } as NodeJS.ProcessEnv
}
