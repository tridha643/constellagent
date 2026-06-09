/**
 * Embedded Agentation HTTP/SSE server (agentation-mcp `startHttpServer` only — no MCP stdio).
 */
import { app, session } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { startHttpServer } from 'agentation-mcp'
import { getAgentationPort, getEmbeddedAgentationEndpoint, markEmbeddedAgentationServerStarted } from './agentation-constants'
import { AGENTATION_WEBVIEW_PARTITION } from '../shared/agentation-types'

export { DEFAULT_AGENTATION_PORT, getAgentationPort, getEmbeddedAgentationEndpoint } from './agentation-constants'

let started = false

/** Start the embedded server unless disabled. Returns the endpoint URL or null. */
export function startEmbeddedAgentationServer(): string | null {
  if (process.env.CONSTELLAGENT_NO_AGENTATION === '1') {
    console.log('[agentation] CONSTELLAGENT_NO_AGENTATION=1 — skipping embedded HTTP server')
    return null
  }
  if (started) return getEmbeddedAgentationEndpoint()

  const port = getAgentationPort()
  const agentationHome = join(app.getPath('userData'), 'agentation-home')
  mkdirSync(join(agentationHome, '.agentation'), { recursive: true })

  const savedHome = process.env.HOME
  process.env.HOME = agentationHome
  if (!process.env.AGENTATION_STORE) process.env.AGENTATION_STORE = 'sqlite'

  try {
    startHttpServer(port)
    started = true
    markEmbeddedAgentationServerStarted()
    const endpoint = getEmbeddedAgentationEndpoint()
    console.log(`[agentation] Embedded HTTP server listening on ${endpoint}`)
    return endpoint
  } catch (err) {
    console.error('[agentation] Failed to start embedded HTTP server:', err)
    return null
  } finally {
    if (savedHome !== undefined) process.env.HOME = savedHome
    else delete process.env.HOME
  }
}

export function isEmbeddedAgentationServerStarted(): boolean {
  return started
}

let webviewSessionConfigured = false

/**
 * Relax CSP for the dedicated Agentation Browser webview partition so the
 * injected annotation guest can load its bundle and reach the embedded server
 * cross-origin — even when the page itself ships a strict `connect-src` /
 * `script-src` policy. Scoped to {@link AGENTATION_WEBVIEW_PARTITION} only, so
 * the main app window keeps its own strict CSP untouched.
 */
export function configureAgentationWebviewSession(): void {
  if (webviewSessionConfigured) return
  webviewSessionConfigured = true

  const webviewSession = session.fromPartition(AGENTATION_WEBVIEW_PARTITION)
  webviewSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {}
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (
        lower === 'content-security-policy' ||
        lower === 'content-security-policy-report-only' ||
        lower === 'x-webkit-csp'
      ) {
        delete headers[key]
      }
    }
    callback({ responseHeaders: headers })
  })
}