/** Avoid crashing the main process when stdout/stderr is closed (Electron EPIPE). */

export function isBrokenPipeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EPIPE'
  )
}

export function safeConsoleCall(fn: () => void): void {
  try {
    fn()
  } catch (error) {
    if (!isBrokenPipeError(error)) throw error
  }
}

export function safeConsoleLog(...args: unknown[]): void {
  safeConsoleCall(() => console.log(...args))
}

export function safeConsoleInfo(...args: unknown[]): void {
  safeConsoleCall(() => console.info(...args))
}

export function safeConsoleWarn(...args: unknown[]): void {
  safeConsoleCall(() => console.warn(...args))
}

export function safeConsoleError(...args: unknown[]): void {
  safeConsoleCall(() => console.error(...args))
}

/** Ignore EPIPE from console writes when the app has no attached terminal. */
export function installMainProcessBrokenPipeGuard(): void {
  const swallow = (error: Error): void => {
    if (!isBrokenPipeError(error)) return
  }

  process.on('uncaughtException', (error) => {
    if (isBrokenPipeError(error)) return
    throw error
  })

  for (const stream of [process.stdout, process.stderr]) {
    stream?.on?.('error', swallow)
  }
}
