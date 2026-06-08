import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'

export type CodexAppServerServerRequestHandler = (
  method: string,
  id: RequestId,
  params: unknown,
) => Promise<unknown>

export type CodexAppServerNotificationHandler = (method: string, params: unknown) => void

type RequestId = string | number

interface PendingRequest {
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
}

export interface CodexAppServerClientOptions {
  readonly codexPath: string
  readonly env: Record<string, string>
  readonly configArgs: readonly string[]
  readonly onNotification: CodexAppServerNotificationHandler
  readonly onServerRequest: CodexAppServerServerRequestHandler
}

export function buildCodexAppServerConfigArgs(webSocketsEnabled: boolean): string[] {
  const args = ['-c', 'features.default_mode_request_user_input=true']
  if (webSocketsEnabled) {
    args.push('-c', 'model_providers.openai.supports_websockets=true')
  }
  return args
}

/** JSON-RPC client for `codex app-server` over stdio. */
export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private readline: Interface | null = null
  private nextId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private ready: Promise<void> | null = null
  private disposed = false

  constructor(private readonly options: CodexAppServerClientOptions) {}

  async ensureReady(): Promise<void> {
    if (this.disposed) throw new Error('Codex app-server client disposed')
    if (!this.ready) {
      this.ready = this.bootstrap()
    }
    await this.ready
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady()
    return this.sendRequest<T>(method, params)
  }

  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    const payload = { id, method, params: params ?? {} }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(String(id), {
        resolve: (result) => resolve(result as T),
        reject,
      })
      this.writeLine(payload)
    })
  }

  sendNotification(method: string, params?: unknown): void {
    this.writeLine({ method, params: params ?? {} })
  }

  dispose(): void {
    this.disposed = true
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Codex app-server client disposed'))
    }
    this.pending.clear()
    this.readline?.close()
    this.readline = null
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM')
    }
    this.child = null
    this.ready = null
  }

  private async bootstrap(): Promise<void> {
    const args = ['app-server', ...this.options.configArgs]
    const child = spawn(this.options.codexPath, args, {
      env: { ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.readline = createInterface({ input: child.stdout })

    child.stderr.on('data', () => {
      // Codex app-server logs diagnostics to stderr; ignore for JSON-RPC transport.
    })
    child.on('error', (err) => {
      this.rejectAll(new Error(`Codex app-server process error: ${err.message}`))
    })
    child.on('exit', (code, signal) => {
      if (!this.disposed) {
        const detail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
        this.rejectAll(new Error(`Codex app-server exited (${detail})`))
      }
    })

    this.readline.on('line', (line) => {
      void this.handleLine(line)
    })

    await this.sendRequest('initialize', {
      clientInfo: {
        name: 'constellagent',
        title: 'Constellagent',
        version: '1.0.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    this.sendNotification('initialized')
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim()
    if (!trimmed) return
    let message: Record<string, unknown>
    try {
      message = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return
    }

    const id = message.id
    const method = typeof message.method === 'string' ? message.method : null

    if (id != null && (Object.prototype.hasOwnProperty.call(message, 'result') || message.error != null)) {
      const pending = this.pending.get(String(id))
      if (!pending) return
      this.pending.delete(String(id))
      if (message.error != null) {
        pending.reject(appServerRpcError(message.error))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (id != null && method) {
      try {
        const result = await this.options.onServerRequest(method, id as RequestId, message.params)
        this.writeLine({ id, result: result ?? {} })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.writeLine({ id, error: { code: -32000, message: msg } })
      }
      return
    }

    if (method) {
      this.options.onNotification(method, message.params)
    }
  }

  private writeLine(payload: unknown): void {
    const stdin = this.child?.stdin
    if (!stdin || stdin.destroyed) {
      throw new Error('Codex app-server stdin unavailable')
    }
    stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function appServerRpcError(error: unknown): Error {
  if (!error || typeof error !== 'object') return new Error('Codex app-server RPC error')
  const record = error as Record<string, unknown>
  const message = typeof record.message === 'string' ? record.message : 'Codex app-server RPC error'
  const code = typeof record.code === 'number' ? record.code : undefined
  return new Error(code != null ? `${message} (code ${code})` : message)
}
