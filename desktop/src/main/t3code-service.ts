import { spawn, type ChildProcess } from 'child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'net'
import { request } from 'http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliEnvWithStandardPath } from './cli-env'

/** Resolves once bundled into `out/main/index.js` (dev) or the packaged main bundle. */
function resolveT3BinPath(): string {
  const mainDir = dirname(fileURLToPath(import.meta.url))
  return join(mainDir, '..', '..', 'node_modules', 't3', 'dist', 'bin.mjs')
}

const STARTUP_TIMEOUT_MS = 120_000

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close(() => resolve(port))
    })
  })
}

function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = (): void => {
      const req = request(url, { method: 'GET', timeout: 5000 }, (res) => {
        res.resume()
        const code = res.statusCode ?? 0
        if (code >= 200 && code < 500) {
          resolve()
          return
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error('T3 Code HTTP did not respond in time'))
        } else {
          setTimeout(tryOnce, 200)
        }
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error('T3 Code HTTP did not respond in time'))
        } else {
          setTimeout(tryOnce, 200)
        }
      })
      req.end()
    }
    tryOnce()
  })
}

type Managed = { proc: ChildProcess; port: number; desktopBootstrapToken: string }

function t3CodeWebUrl(port: number, desktopBootstrapToken: string): string {
  // Load `/pair` directly. The default `/` → `/_chat` route redirects unauthenticated users to `/pair`
  // without preserving `?token=`, so `http://127.0.0.1:port/?token=...` loses the bootstrap credential
  // before PairingRouteSurface can read it (see pingdotgg/t3code routes/_chat.tsx).
  const q = new URLSearchParams({ token: desktopBootstrapToken })
  return `http://127.0.0.1:${port}/pair?${q.toString()}`
}

/** Same JSON envelope as the official T3 Code desktop app sends on fd 3 (see pingdotgg/t3code apps/desktop). */
function writeDesktopBootstrapEnvelope(
  proc: ChildProcess,
  port: number,
  desktopBootstrapToken: string,
): void {
  const stream = proc.stdio[3]
  if (!stream || typeof stream !== 'object' || !('write' in stream)) {
    throw new Error('T3 Code: bootstrap pipe (stdio fd 3) is missing')
  }
  const line =
    `${JSON.stringify({
      mode: 'desktop',
      noBrowser: true,
      port,
      host: '127.0.0.1',
      desktopBootstrapToken,
    })}\n`
  ;(stream as NodeJS.Writable).write(line)
  ;(stream as NodeJS.Writable).end()
}

class T3CodeService {
  private byCwd = new Map<string, Managed>()
  private starting = new Map<string, Promise<string>>()

  async start(cwd: string): Promise<string> {
    const existing = this.byCwd.get(cwd)
    if (existing) {
      return t3CodeWebUrl(existing.port, existing.desktopBootstrapToken)
    }

    const pending = this.starting.get(cwd)
    if (pending) return pending

    const p = this.startImpl(cwd).finally(() => {
      this.starting.delete(cwd)
    })
    this.starting.set(cwd, p)
    return p
  }

  private async startImpl(cwd: string): Promise<string> {
    const port = await getFreePort()
    const desktopBootstrapToken = randomBytes(32).toString('hex')
    const t3Bin = resolveT3BinPath()
    if (!existsSync(t3Bin)) {
      throw new Error(
        `T3 Code CLI not found at ${t3Bin}. Run install in the desktop package so the \`t3\` dependency is present.`,
      )
    }

    // `npx` spawns a nested Node process, so stdio fd 3 never reaches `t3` (BootstrapError / EBADF on macOS).
    // Spawn the bundled CLI directly and run Electron as Node, matching pingdotgg/t3code's desktop backend.
    const args = [
      t3Bin,
      '--no-browser',
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      '--mode',
      'desktop',
      '--bootstrap-fd',
      '3',
    ]

    const proc = spawn(process.execPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      env: {
        ...cliEnvWithStandardPath(),
        ELECTRON_RUN_AS_NODE: '1',
      },
    })

    try {
      writeDesktopBootstrapEnvelope(proc, port, desktopBootstrapToken)
    } catch (err) {
      try {
        proc.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      throw err instanceof Error ? err : new Error(String(err))
    }

    let buf = ''
    const url = `http://127.0.0.1:${port}`

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const startedAt = Date.now()

      const cleanup = (): void => {
        clearTimeout(timer)
        proc.stdout?.off('data', onData)
        proc.stderr?.off('data', onData)
        proc.removeListener('exit', onExitEarly)
        proc.removeListener('error', onSpawnError)
      }

      const settleOk = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }

      const settleErr = (err: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        try {
          proc.kill('SIGTERM')
        } catch {
          /* ignore */
        }
        reject(err)
      }

      const timer = setTimeout(() => {
        settleErr(
          new Error(
            `T3 Code server startup timed out (${STARTUP_TIMEOUT_MS / 1000}s). Is the \`t3\` dependency installed? ${buf.slice(-1200)}`
          )
        )
      }, STARTUP_TIMEOUT_MS)

      const onData = (d: Buffer): void => {
        buf += d.toString()
        if (buf.length > 120_000) buf = buf.slice(-60_000)
        if (buf.includes('T3 Code running')) settleOk()
      }

      const onExitEarly = (code: number | null, signal: NodeJS.Signals | null): void => {
        settleErr(
          new Error(
            `T3 Code exited before ready (${signal || `code ${code}`}). ${buf.slice(-1200)}`
          )
        )
      }

      const onSpawnError = (err: Error): void => {
        settleErr(new Error(`T3 Code spawn failed: ${err.message}. ${buf.slice(-1200)}`))
      }

      const tryHttp = (): void => {
        if (settled) return
        if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) return
        const req = request(url, { method: 'GET', timeout: 5000 }, (res) => {
          res.resume()
          const code = res.statusCode ?? 0
          if (code >= 200 && code < 500) {
            settleOk()
            return
          }
          setTimeout(tryHttp, 200)
        })
        req.on('error', () => {
          if (!settled) setTimeout(tryHttp, 200)
        })
        req.end()
      }

      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onData)
      proc.once('exit', onExitEarly)
      proc.once('error', onSpawnError)
      tryHttp()
    })

    await waitForHttpOk(url, 20_000)

    proc.once('exit', () => {
      this.byCwd.delete(cwd)
    })

    this.byCwd.set(cwd, { proc, port, desktopBootstrapToken })
    return t3CodeWebUrl(port, desktopBootstrapToken)
  }

  stop(cwd: string): void {
    const m = this.byCwd.get(cwd)
    if (!m) return
    m.proc.kill('SIGTERM')
    this.byCwd.delete(cwd)
  }

  stopAll(): void {
    for (const cwd of [...this.byCwd.keys()]) {
      this.stop(cwd)
    }
  }
}

export const t3codeService = new T3CodeService()
