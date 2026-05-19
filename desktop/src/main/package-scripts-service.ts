// Walks up from a workspace dir to the nearest package.json and exposes its `scripts`
// for the Service-tab launcher. Stops at the git root (if any) or filesystem root.
import { existsSync, readFileSync } from 'fs'
import { dirname, join, parse, resolve } from 'path'
import type { PackageScript, PackageScriptsResult } from '../shared/service-types'

const WELL_KNOWN_FIRST = ['dev', 'start', 'serve', 'test', 'test:watch', 'build', 'lint']

function isGitRoot(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

function findNearestPackageJson(startDir: string): string | null {
  let cur = resolve(startDir)
  const root = parse(cur).root
  while (true) {
    const candidate = join(cur, 'package.json')
    if (existsSync(candidate)) return candidate
    if (isGitRoot(cur)) return null
    const next = dirname(cur)
    if (next === cur || cur === root) return null
    cur = next
  }
}

function sortScripts(scripts: PackageScript[]): PackageScript[] {
  const wellKnownIndex = new Map<string, number>(WELL_KNOWN_FIRST.map((n, i) => [n, i]))
  return [...scripts].sort((a, b) => {
    const ai = wellKnownIndex.get(a.name)
    const bi = wellKnownIndex.get(b.name)
    if (ai !== undefined && bi !== undefined) return ai - bi
    if (ai !== undefined) return -1
    if (bi !== undefined) return 1
    return a.name.localeCompare(b.name)
  })
}

export function readPackageScripts(workingDir: string): PackageScriptsResult {
  const packageJsonPath = findNearestPackageJson(workingDir)
  if (!packageJsonPath) {
    return { missing: true, scripts: [], packageJsonPath: null }
  }
  let raw: string
  try {
    raw = readFileSync(packageJsonPath, 'utf-8')
  } catch {
    return { missing: true, scripts: [], packageJsonPath: null }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { missing: false, scripts: [], packageJsonPath }
  }
  const scriptsRaw = (parsed && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>).scripts
    : null) as Record<string, unknown> | null | undefined
  if (!scriptsRaw || typeof scriptsRaw !== 'object') {
    return { missing: false, scripts: [], packageJsonPath }
  }
  const scripts: PackageScript[] = []
  for (const [name, command] of Object.entries(scriptsRaw)) {
    if (typeof command !== 'string') continue
    if (!name.trim()) continue
    scripts.push({ name, command })
  }
  return { missing: false, scripts: sortScripts(scripts), packageJsonPath }
}
