/**
 * Bundled entry injected into the Browser webview guest page.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Agentation } from 'agentation'

declare global {
  interface Window {
    __CONSTELLAGENT_AGENTATION_ENDPOINT__?: string
    __CONSTELLAGENT_AGENTATION_SESSION_ID__?: string
    constellagentAgentationBridge?: {
      copyMarkdown: (markdown: string) => void
      submitAnnotations: (output: string) => void
      sessionCreated: (sessionId: string) => void
    }
  }
}

const endpoint = window.__CONSTELLAGENT_AGENTATION_ENDPOINT__ ?? 'http://127.0.0.1:4747'
const sessionId = window.__CONSTELLAGENT_AGENTATION_SESSION_ID__
const bridge = window.constellagentAgentationBridge

const mount = document.createElement('div')
mount.id = 'constellagent-agentation-root'
document.documentElement.appendChild(mount)

createRoot(mount).render(
  <StrictMode>
    <Agentation
      endpoint={endpoint}
      sessionId={sessionId}
      copyToClipboard={false}
      onCopy={(markdown) => bridge?.copyMarkdown(markdown)}
      onSubmit={(output) => {
        bridge?.copyMarkdown(output)
        bridge?.submitAnnotations(output)
      }}
      onSessionCreated={(id) => bridge?.sessionCreated(id)}
    />
  </StrictMode>,
)
