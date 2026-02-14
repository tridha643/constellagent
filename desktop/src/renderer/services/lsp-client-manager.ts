/**
 * LSP Client Manager — connects Monaco editors to LSP servers via WebSocket.
 * Singleton that manages one client per (language, workspace) pair.
 * All initialization is async and non-blocking — editor mounts immediately.
 */

const LSP_LANGUAGES = new Set(['python', 'go', 'rust'])

interface LspClient {
  ws: WebSocket
  ready: boolean
  pendingRequests: Map<number, { resolve: (result: unknown) => void; reject: (err: Error) => void }>
  nextId: number
  disposed: boolean
}

const clients = new Map<string, LspClient>()
const initPromises = new Map<string, Promise<LspClient | null>>()

function clientKey(language: string, workspace: string): string {
  return `${language}:${workspace}`
}

export function isLspLanguage(language: string): boolean {
  return LSP_LANGUAGES.has(language)
}

export async function getOrCreateClient(language: string, workspace: string): Promise<LspClient | null> {
  const key = clientKey(language, workspace)

  const existing = clients.get(key)
  if (existing && !existing.disposed) return existing

  // Deduplicate concurrent init calls
  const pending = initPromises.get(key)
  if (pending) return pending

  const promise = initClient(language, workspace, key)
  initPromises.set(key, promise)
  try {
    return await promise
  } finally {
    initPromises.delete(key)
  }
}

async function initClient(language: string, workspace: string, key: string): Promise<LspClient | null> {
  try {
    const port = await window.api.lsp.getPort()
    if (!port) return null

    const ws = new WebSocket(`ws://127.0.0.1:${port}?language=${language}&workspace=${encodeURIComponent(workspace)}`)

    const client: LspClient = {
      ws,
      ready: false,
      pendingRequests: new Map(),
      nextId: 1,
      disposed: false,
    }

    return await new Promise<LspClient | null>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close()
        resolve(null)
      }, 5000)

      ws.onopen = () => {
        clearTimeout(timeout)
        client.ready = true
        clients.set(key, client)

        // Send LSP initialize
        sendRequest(client, 'initialize', {
          processId: null,
          rootUri: `file://${workspace}`,
          capabilities: {
            textDocument: {
              completion: { completionItem: { snippetSupport: true } },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              publishDiagnostics: { relatedInformation: true },
            },
          },
        }).then(() => {
          sendNotification(client, 'initialized', {})
        }).catch(() => {})

        resolve(client)
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        resolve(null)
      }

      ws.onclose = () => {
        client.disposed = true
        clients.delete(key)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : '')
          if (msg.id !== undefined && client.pendingRequests.has(msg.id)) {
            const req = client.pendingRequests.get(msg.id)!
            client.pendingRequests.delete(msg.id)
            if (msg.error) req.reject(new Error(msg.error.message))
            else req.resolve(msg.result)
          }
          // Diagnostics and other notifications can be handled here in the future
        } catch {}
      }
    })
  } catch {
    return null
  }
}

function sendRequest(client: LspClient, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (client.disposed || client.ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Client disposed'))
      return
    }
    const id = client.nextId++
    client.pendingRequests.set(id, { resolve, reject })
    client.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

function sendNotification(client: LspClient, method: string, params: unknown): void {
  if (client.disposed || client.ws.readyState !== WebSocket.OPEN) return
  client.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
}

/** Notify the LSP server that a file was opened */
export function notifyDidOpen(language: string, workspace: string, uri: string, text: string, languageId: string): void {
  const key = clientKey(language, workspace)
  const client = clients.get(key)
  if (!client || client.disposed) return

  sendNotification(client, 'textDocument/didOpen', {
    textDocument: { uri, languageId, version: 1, text },
  })
}

/** Notify the LSP server that a file was closed */
export function notifyDidClose(language: string, workspace: string, uri: string): void {
  const key = clientKey(language, workspace)
  const client = clients.get(key)
  if (!client || client.disposed) return

  sendNotification(client, 'textDocument/didClose', {
    textDocument: { uri },
  })
}
