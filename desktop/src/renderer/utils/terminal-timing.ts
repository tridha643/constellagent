const TERMINAL_TIMING_STORAGE_KEY = 'constellagent.terminalTiming'

export function terminalTimingEnabled(): boolean {
  try {
    return localStorage.getItem(TERMINAL_TIMING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function terminalTimingMs(start: number, end = performance.now()): number {
  return Math.round((end - start) * 10) / 10
}

export function logTerminalTiming(message: string, data: Record<string, unknown>): void {
  if (!terminalTimingEnabled()) return
  console.info('[terminal:timing]', message, data)
}
