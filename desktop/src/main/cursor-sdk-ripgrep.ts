import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { cliEnvWithStandardPath } from './cli-env'

const PLATFORM_PKG = `@cursor/sdk-${process.platform}-${process.arch}`
const RG_NAME = process.platform === 'win32' ? 'rg.exe' : 'rg'

function bundledSdkRipgrepCandidates(): string[] {
  const roots = [
    join(__dirname, '..', '..', 'node_modules'),
    join(__dirname, '..', '..', '..', 'node_modules'),
  ]
  const out: string[] = []
  for (const root of roots) {
    out.push(join(root, PLATFORM_PKG, 'bin', RG_NAME))
  }
  return out
}

function resolveCursorAgentRipgrep(): string | undefined {
  const versionsDir = join(homedir(), '.local', 'share', 'cursor-agent', 'versions')
  if (!existsSync(versionsDir)) return undefined
  const versions = readdirSync(versionsDir).sort().reverse()
  for (const version of versions) {
    const candidate = join(versionsDir, version, RG_NAME)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function resolveRipgrepOnPath(): string | undefined {
  const env = cliEnvWithStandardPath()
  const names = ['rg', RG_NAME]
  for (const name of names) {
    try {
      const lookup = process.platform === 'win32' ? 'where' : 'which'
      const out = execFileSync(lookup, [name], { encoding: 'utf8', env, timeout: 5000 })
      const line = out.trim().split(/\r?\n/)[0]?.trim()
      if (line && existsSync(line)) return line
    } catch {
      // try next
    }
  }
  for (const candidate of [
    join(homedir(), '.local', 'bin', RG_NAME),
    '/opt/homebrew/bin/rg',
    '/usr/local/bin/rg',
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Resolve an absolute path to ripgrep for @cursor/sdk local agents. */
export function resolveRipgrepPath(): string | undefined {
  const fromEnv = process.env.CURSOR_RIPGREP_PATH?.trim()
  if (fromEnv && isAbsolute(fromEnv) && existsSync(fromEnv)) return fromEnv

  for (const candidate of bundledSdkRipgrepCandidates()) {
    if (existsSync(candidate)) return candidate
  }

  const fromCursorAgent = resolveCursorAgentRipgrep()
  if (fromCursorAgent) return fromCursorAgent

  return resolveRipgrepOnPath()
}

/**
 * @cursor/sdk local agents need ripgrep for .gitignore / .cursorignore indexing.
 * GUI Electron often lacks `rg` on PATH; set CURSOR_RIPGREP_PATH before Agent.create.
 */
export function configureCursorSdkRipgrep(): void {
  const existing = process.env.CURSOR_RIPGREP_PATH?.trim()
  if (existing && isAbsolute(existing) && existsSync(existing)) return

  const resolved = resolveRipgrepPath()
  if (resolved) {
    process.env.CURSOR_RIPGREP_PATH = resolved
  }
}
