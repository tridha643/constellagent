/**
 * LSP Client Manager — connects Monaco editors to LSP servers via WebSocket.
 * Singleton that manages one client per (language, workspace) pair.
 * All initialization is async and non-blocking — editor mounts immediately.
 */

import type { MonacoLanguageId } from '../utils/language-map'
import { getLanguage } from '../utils/language-map'

/** Spawn keys matching main-process `LSP_SERVERS[].language` in `lsp-config.ts`. */
const LSP_LANGUAGES = new Set(['python', 'go', 'rust', 'typescript', 'prisma'] as const)

const TS_JS_MONACO_LANGS = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact'])
const LSP_MARKER_OWNER_PREFIX = 'lsp:'

export type LspServerKey = 'python' | 'go' | 'rust' | 'typescript' | 'prisma'

interface LspDiagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  severity?: number
  message: string
  code?: string | number
  source?: string
}

interface LspClient {
  ws: WebSocket
  ready: boolean
  pendingRequests: Map<number, { resolve: (result: unknown) => void; reject: (err: Error) => void }>
  nextId: number
  disposed: boolean
  documentVersions: Map<string, number>
}

const clients = new Map<string, LspClient>()
const initPromises = new Map<string, Promise<LspClient | null>>()
let monacoImportPromise: Promise<typeof import('monaco-editor')> | null = null

function clientKey(language: string, workspace: string): string {
  return `${language}:${workspace}`
}

export function isLspLanguage(language: string): boolean {
  return LSP_LANGUAGES.has(language)
}

/** LSP process / WebSocket key for this file (e.g. all TS/JS Monaco langs share `typescript`). */
export function getLspServerKeyForPath(
  filePath: string,
  languageOverride?: MonacoLanguageId | null,
): LspServerKey | null {
  const lang = languageOverride ?? getLanguage(filePath)
  if (TS_JS_MONACO_LANGS.has(lang)) return 'typescript'
  if (lang === 'prisma' || filePath.toLowerCase().endsWith('.prisma')) return 'prisma'
  if (LSP_LANGUAGES.has(lang)) return lang
  return null
}

/** `languageId` for `textDocument/didOpen` (must match what each server expects). */
export function getLspTextDocumentLanguageId(
  filePath: string,
  languageOverride?: MonacoLanguageId | null,
): MonacoLanguageId | 'prisma' {
  const lang = languageOverride ?? getLanguage(filePath)
  if (filePath.toLowerCase().endsWith('.prisma') || lang === 'prisma') return 'prisma'
  return lang
}

export function toFileUri(filePath: string): string {
  return encodeURI(`file://${filePath}`)
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
      documentVersions: new Map(),
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
        rejectPendingRequests(client, new Error('LSP socket error'))
        resolve(null)
      }

      ws.onclose = () => {
        client.disposed = true
        rejectPendingRequests(client, new Error('LSP socket closed'))
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
            return
          }
          if (msg.method === 'textDocument/publishDiagnostics' && msg.params?.uri) {
            void applyDiagnostics(language, msg.params.uri, msg.params.diagnostics ?? [])
          }
        } catch {}
      }
    })
  } catch {
    return null
  }
}

function rejectPendingRequests(client: LspClient, error: Error): void {
  for (const [, pending] of client.pendingRequests) {
    pending.reject(error)
  }
  client.pendingRequests.clear()
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

function toMarkerSeverity(monacoSeverity: number | undefined): 1 | 2 | 4 | 8 {
  switch (monacoSeverity) {
    case 1:
      return 8
    case 2:
      return 4
    case 3:
      return 2
    case 4:
      return 1
    default:
      return 4
  }
}

function markerOwner(language: string): string {
  return `${LSP_MARKER_OWNER_PREFIX}${language}`
}

async function loadMonaco() {
  if (!monacoImportPromise) {
    monacoImportPromise = import('monaco-editor')
  }
  return monacoImportPromise
}

function closeClient(key: string, client: LspClient): void {
  rejectPendingRequests(client, new Error('LSP client closed'))
  client.disposed = true
  clients.delete(key)
  try {
    client.ws.close()
  } catch {
    // best effort
  }
}

async function applyDiagnostics(language: string, uri: string, diagnostics: LspDiagnostic[]): Promise<void> {
  const monaco = await loadMonaco()
  const model = monaco.editor.getModel(monaco.Uri.parse(uri))
  if (!model) return
  monaco.editor.setModelMarkers(
    model,
    markerOwner(language),
    diagnostics.map((diagnostic) => ({
      severity: toMarkerSeverity(diagnostic.severity),
      startLineNumber: diagnostic.range.start.line + 1,
      startColumn: diagnostic.range.start.character + 1,
      endLineNumber: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1,
      message: diagnostic.message,
      code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
      source: diagnostic.source,
    })),
  )
}

export async function clearLspDiagnosticsForUri(uri: string, language?: string | null): Promise<void> {
  const monaco = await loadMonaco()
  const model = monaco.editor.getModel(monaco.Uri.parse(uri))
  if (!model) return
  const owners = language ? [markerOwner(language)] : Array.from(LSP_LANGUAGES, (key) => markerOwner(key))
  for (const owner of owners) {
    monaco.editor.setModelMarkers(model, owner, [])
  }
}

/** Notify the LSP server that a file was opened */
export function notifyDidOpen(language: string, workspace: string, uri: string, text: string, languageId: string): void {
  const key = clientKey(language, workspace)
  const client = clients.get(key)
  if (!client || client.disposed) return

  client.documentVersions.set(uri, 1)
  sendNotification(client, 'textDocument/didOpen', {
    textDocument: { uri, languageId, version: 1, text },
  })
}

/** Notify the LSP server that a file changed; sends full-document sync. */
export function notifyDidChange(language: string, workspace: string, uri: string, text: string): void {
  const key = clientKey(language, workspace)
  const client = clients.get(key)
  if (!client || client.disposed) return
  const previousVersion = client.documentVersions.get(uri)
  if (previousVersion == null) return
  const version = previousVersion + 1
  client.documentVersions.set(uri, version)
  sendNotification(client, 'textDocument/didChange', {
    textDocument: { uri, version },
    contentChanges: [{ text }],
  })
}

/** Notify the LSP server that a file was closed */
export function notifyDidClose(language: string, workspace: string, uri: string): void {
  const key = clientKey(language, workspace)
  const client = clients.get(key)
  if (!client || client.disposed) {
    void clearLspDiagnosticsForUri(uri, language)
    return
  }

  client.documentVersions.delete(uri)
  sendNotification(client, 'textDocument/didClose', {
    textDocument: { uri },
  })
  if (client.documentVersions.size === 0) {
    closeClient(key, client)
  }
  void clearLspDiagnosticsForUri(uri, language)
}
