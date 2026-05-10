import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Load `.env` / `.env.local` into `process.env` for the main process only (renderer does not see these).
 * Later files override earlier ones; host/shell values always win unless empty string.
 */
export function loadMainProcessEnvFiles(): void {
  const cwd = process.cwd()
  const paths: string[] = [
    join(cwd, '.env'),
    join(cwd, '.env.local'),
    join(cwd, 'desktop', '.env'),
    join(cwd, 'desktop', '.env.local'),
  ]
  const merged: Record<string, string> = {}
  for (const filePath of paths) {
    if (!existsSync(filePath)) continue
    Object.assign(merged, parseEnvFile(filePath))
  }
  for (const [key, val] of Object.entries(merged)) {
    const cur = process.env[key]
    if (cur !== undefined && cur !== '') continue
    process.env[key] = val
  }
}

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return out
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

loadMainProcessEnvFiles()