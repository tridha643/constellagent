import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './themes/diff/registerPierreThemes'
import { App } from './App'
import { useAppStore, hydrateFromDisk } from './store/app-store'
import { applyAppearanceTheme } from './theme/appearance'
import '@xterm/xterm/css/xterm.css'
import './styles/global.css'
import './styles/shared-dialog-motion.css'

// Expose store for e2e testing
;(window as any).__store = useAppStore

function installBenignBrowserErrorFilters(): void {
  window.addEventListener('error', (event) => {
    const message = event.message || String(event.error?.message ?? '')
    if (
      message === 'ResizeObserver loop completed with undelivered notifications.' ||
      message === 'ResizeObserver loop limit exceeded'
    ) {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
  })
}

function renderApp(): void {
  applyAppearanceTheme(useAppStore.getState().settings.appearanceThemeId)
  const root = createRoot(document.getElementById('root')!)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

function renderMissingApiNotice(): void {
  // The Electron preload exposes window.api via contextBridge. If it's absent,
  // the renderer is running without the preload (e.g. opened in a plain browser,
  // or the preload failed to load) — surface it instead of a silent blank screen.
  const el = document.getElementById('root')
  if (el) {
    el.textContent =
      'Constellagent failed to initialize: the Electron preload bridge (window.api) is unavailable. Fully quit (⌘Q) and relaunch `bun run dev`.'
    el.style.cssText = 'padding:24px;font:14px/1.5 ui-sans-serif,system-ui;color:#e5e7eb'
  }
  console.error('[renderer] window.api is undefined — preload bridge not loaded')
}

function isBrowserWebviewGuest(): boolean {
  return (
    typeof window !== 'undefined' &&
    !window.api &&
    !!(window as Window & { constellagentAgentationBridge?: unknown }).constellagentAgentationBridge
  )
}

if (isBrowserWebviewGuest()) {
  // Browser tab webview loads pages with browser-guest-preload only (no window.api).
  // Agentation is injected separately; do not bootstrap the main app or show an error.
} else if (typeof window === 'undefined' || !window.api) {
  // Vite HMR can re-run this entry outside Electron; only show the notice in a real document.
  if (typeof document !== 'undefined') renderMissingApiNotice()
} else {
  installBenignBrowserErrorFilters()
  // Hydrate persisted state (tabs, PTYs) before rendering to avoid mounting
  // terminals with stale pty IDs. Never let a slow/failed hydrate (e.g. a
  // hanging IPC call) block the first paint — mount regardless once hydrate
  // settles or after a short timeout.
  let mounted = false
  const mountOnce = (): void => {
    if (mounted) return
    mounted = true
    renderApp()
  }
  const safetyTimer = setTimeout(mountOnce, 3000)
  hydrateFromDisk()
    .catch((err) => {
      console.error('[renderer] hydrateFromDisk failed:', err)
    })
    .finally(() => {
      clearTimeout(safetyTimer)
      mountOnce()
    })
}
