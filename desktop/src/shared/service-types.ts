export type ServiceStatus = 'running' | 'exited' | 'crashed'

export interface PackageScript {
  name: string
  command: string
}

export interface PackageScriptsResult {
  missing: boolean
  scripts: PackageScript[]
  packageJsonPath: string | null
}

/**
 * 0 = clean exit. 130/143 = SIGINT/SIGTERM, which is how Ctrl+C and our Stop button
 * land here — we treat those as `exited`, not `crashed`, so the UI doesn't flag user
 * interruption as a failure. Everything else (1, 2, 137 OOM, etc.) is a real crash.
 */
export function classifyExit(code: number): ServiceStatus {
  if (code === 0 || code === 130 || code === 143) return 'exited'
  return 'crashed'
}
