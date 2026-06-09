/**
 * Bundled entry injected into the Browser webview guest page.
 * Loaded via <script type="module"> from the renderer dev server or build output.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Agentation } from 'agentation'

declare global {
  interface Window {
    __CONSTELLAGENT_AGENTATION_ENDPOINT__?: string
  }
}

const endpoint = window.__CONSTELLAGENT_AGENTATION_ENDPOINT__ ?? 'http://localhost:4747'

const mount = document.createElement('div')
mount.id = 'constellagent-agentation-root'
document.documentElement.appendChild(mount)

createRoot(mount).render(
  <StrictMode>
    <Agentation endpoint={endpoint} />
  </StrictMode>,
)
