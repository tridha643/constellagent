import { WebSocketServer, type WebSocket } from 'ws'
import { createServer, type Server } from 'http'
import { LspServerManager } from './lsp-server-manager'
import { getAvailableLanguages } from './lsp-config'

export class LspService {
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private serverManager = new LspServerManager()
  private port = 0

  async start(): Promise<number> {
    if (this.httpServer) return this.port

    return new Promise((resolve, reject) => {
      const server = createServer()
      const wss = new WebSocketServer({ server })

      wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req.url ?? '')
      })

      // Listen on dynamic port
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
          this.httpServer = server
          this.wss = wss
          console.info(`[lsp] WebSocket server listening on port ${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('Failed to get server address'))
        }
      })

      server.on('error', reject)
    })
  }

  getPort(): number {
    return this.port
  }

  getAvailableLanguages(): string[] {
    return getAvailableLanguages()
  }

  private handleConnection(ws: WebSocket, url: string): void {
    const params = new URL(url, 'http://localhost').searchParams
    const language = params.get('language')
    const workspace = params.get('workspace')

    if (!language || !workspace) {
      ws.close(1008, 'Missing language or workspace parameter')
      return
    }

    const lspProcess = this.serverManager.getOrSpawn(language, workspace)
    if (!lspProcess || !lspProcess.stdin || !lspProcess.stdout) {
      ws.close(1011, `LSP server for ${language} not available`)
      return
    }

    // Bridge WebSocket ↔ stdio using LSP base protocol (Content-Length headers)
    const stdout = lspProcess.stdout

    // Buffer for parsing LSP messages from stdout
    let buffer = Buffer.alloc(0)
    const HEADER_SEPARATOR = Buffer.from('\r\n\r\n')

    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const sepIndex = buffer.indexOf(HEADER_SEPARATOR)
        if (sepIndex === -1) break

        const header = buffer.subarray(0, sepIndex).toString('utf-8')
        const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i)
        if (!contentLengthMatch) {
          // Malformed header, skip
          buffer = buffer.subarray(sepIndex + HEADER_SEPARATOR.length)
          continue
        }

        const contentLength = parseInt(contentLengthMatch[1], 10)
        const bodyStart = sepIndex + HEADER_SEPARATOR.length
        if (buffer.length < bodyStart + contentLength) break // incomplete body

        const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf-8')
        buffer = buffer.subarray(bodyStart + contentLength)

        if (ws.readyState === ws.OPEN) {
          ws.send(body)
        }
      }
    }

    stdout.on('data', onData)

    ws.on('message', (data) => {
      const message = typeof data === 'string' ? data : data.toString('utf-8')
      const header = `Content-Length: ${Buffer.byteLength(message, 'utf-8')}\r\n\r\n`
      try {
        lspProcess.stdin!.write(header)
        lspProcess.stdin!.write(message)
      } catch {
        // Process may have died
      }
    })

    ws.on('close', () => {
      stdout.removeListener('data', onData)
    })

    ws.on('error', () => {
      stdout.removeListener('data', onData)
    })
  }

  shutdown(): void {
    this.serverManager.shutdown()
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close()
      }
      this.wss.close()
      this.wss = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
    this.port = 0
  }
}
