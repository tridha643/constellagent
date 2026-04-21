const PERF_ENV_FLAG = 'CONSTELLAGENT_PERF_DEBUG'
const SLOW_MAIN_MS = 40

export function isMainPerfDebugEnabled(): boolean {
  return process.env[PERF_ENV_FLAG] === '1'
}

export function logMainPerfEvent(
  label: string,
  durationMs: number,
  meta?: Record<string, unknown>,
): void {
  if (!isMainPerfDebugEnabled()) return
  if (durationMs < SLOW_MAIN_MS) return
  console.info(`[perf][main] ${label}`, {
    durationMs: Math.round(durationMs * 10) / 10,
    ...meta,
  })
}

export async function measureMainAsync<T>(
  label: string,
  run: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  if (!isMainPerfDebugEnabled()) return run()
  const started = performance.now()
  try {
    return await run()
  } finally {
    logMainPerfEvent(label, performance.now() - started, meta)
  }
}
