const PERF_STORAGE_KEY = 'constellagent:perf'
const SLOW_RENDER_MS = 48

function canReadLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function isPerfDebugEnabled(): boolean {
  if (!canReadLocalStorage()) return false
  try {
    return window.localStorage.getItem(PERF_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function logPerfEvent(
  label: string,
  durationMs: number,
  meta?: Record<string, unknown>,
): void {
  if (!isPerfDebugEnabled()) return
  if (durationMs < SLOW_RENDER_MS) return
  console.info(`[perf][renderer] ${label}`, {
    durationMs: Math.round(durationMs * 10) / 10,
    ...meta,
  })
}

export async function measureAsync<T>(
  label: string,
  run: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  if (!isPerfDebugEnabled()) return run()
  const started = performance.now()
  try {
    return await run()
  } finally {
    logPerfEvent(label, performance.now() - started, meta)
  }
}

export function markPaint(
  label: string,
  startedAt: number,
  meta?: Record<string, unknown>,
): void {
  if (!isPerfDebugEnabled()) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      logPerfEvent(label, performance.now() - startedAt, meta)
    })
  })
}
