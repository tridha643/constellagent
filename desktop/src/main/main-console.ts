/** Avoid crashing the main process when stdout/stderr is closed (Electron EPIPE). */

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

const originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
}

let brokenPipeGuardInstalled = false

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
  safeConsoleCall(() => originalConsole.log(...args))
}

export function safeConsoleInfo(...args: unknown[]): void {
  safeConsoleCall(() => originalConsole.info(...args))
}

export function safeConsoleWarn(...args: unknown[]): void {
  safeConsoleCall(() => originalConsole.warn(...args))
}

export function safeConsoleError(...args: unknown[]): void {
  safeConsoleCall(() => originalConsole.error(...args))
}

function patchConsoleMethods(): void {
  for (const method of Object.keys(originalConsole) as ConsoleMethod[]) {
    const original = originalConsole[method]
    console[method] = (...args: unknown[]) => safeConsoleCall(() => original(...args))
  }
}

function patchStreamWrite(stream: NodeJS.WriteStream | undefined): void {
  if (!stream?.write) return
  const originalWrite = stream.write.bind(stream) as NodeJS.WriteStream['write']
  stream.write = ((chunk, encoding, callback) => {
    try {
      return originalWrite(chunk, encoding as BufferEncoding, callback)
    } catch (error) {
      if (isBrokenPipeError(error)) {
        if (typeof callback === 'function') callback(error as NodeJS.ErrnoException)
        return false
      }
      throw error
    }
  }) as NodeJS.WriteStream['write']
}

/** Ignore EPIPE from console writes when the app has no attached terminal. */
export function installMainProcessBrokenPipeGuard(): void {
  if (brokenPipeGuardInstalled) return
  brokenPipeGuardInstalled = true

  patchConsoleMethods()
  patchStreamWrite(process.stdout)
  patchStreamWrite(process.stderr)

  const swallowStreamError = (error: Error): void => {
    if (!isBrokenPipeError(error)) return
  }

  process.on('uncaughtException', (error) => {
    if (isBrokenPipeError(error)) return
  })

  for (const stream of [process.stdout, process.stderr]) {
    stream?.on?.('error', swallowStreamError)
  }
}
