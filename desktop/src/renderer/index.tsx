import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useAppStore, hydrateFromDisk } from './store/app-store'
import { applyAppearanceTheme } from './theme/appearance'
import '@xterm/xterm/css/xterm.css'
import './styles/global.css'
import './styles/shared-dialog-motion.css'
import './styles/streamdown-table.css'

// Expose store for e2e testing
;(window as any).__store = useAppStore

// Hydrate persisted state (tabs, PTYs) BEFORE rendering to avoid
// mounting terminals with stale pty IDs that get replaced moments later.
hydrateFromDisk().then(() => {
  applyAppearanceTheme(useAppStore.getState().settings.appearanceThemeId)
  const root = createRoot(document.getElementById('root')!)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
