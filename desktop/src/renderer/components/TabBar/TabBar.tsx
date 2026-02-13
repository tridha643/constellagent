import { useCallback } from 'react'
import { useAppStore } from '../../store/app-store'
import type { Tab } from '../../store/types'
import { getAllPtyIds } from '../../store/split-helpers'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './TabBar.module.css'

const TAB_ICONS: Record<Tab['type'], { icon: string; className: string }> = {
  terminal: { icon: '⌘', className: styles.terminal },
  file: { icon: '◇', className: styles.file },
  diff: { icon: '±', className: styles.diff },
}

function getTabTitle(tab: Tab): string {
  if (tab.type === 'terminal') return tab.title
  if (tab.type === 'diff') return 'Changes'
  const name = tab.filePath.split('/').pop() || tab.filePath
  return name
}

export function TabBar() {
  const { activeTabId, setActiveTab, removeTab, activeWorkspaceTabs, createTerminalForActiveWorkspace, lastSavedTabId, settings } = useAppStore()
  const tabs = activeWorkspaceTabs()

  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation()
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return

      if (tab.type === 'file' && tab.unsaved && settings.confirmOnClose) {
        if (!window.confirm(`"${getTabTitle(tab)}" has unsaved changes. Close anyway?`)) return
      }

      if (tab.type === 'terminal') {
        if (tab.splitRoot) {
          getAllPtyIds(tab.splitRoot).forEach((id) => window.api.pty.destroy(id))
        } else {
          window.api.pty.destroy(tab.ptyId)
        }
      }
      removeTab(tabId)
    },
    [tabs, removeTab]
  )

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabList}>
        {tabs.map((tab) => {
          const { icon, className } = TAB_ICONS[tab.type]
          const isSaved = tab.id === lastSavedTabId
          return (
            <div
              key={tab.id}
              className={`${styles.tab} ${tab.id === activeTabId ? styles.active : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className={`${styles.tabIcon} ${className}`}>{icon}</span>
              <span className={`${styles.tabTitle} ${isSaved ? styles.savedFlash : ''}`}>
                {getTabTitle(tab)}
              </span>
              {tab.type === 'file' && tab.unsaved ? (
                <span className={styles.unsavedDot} />
              ) : (
                <Tooltip label="Close tab" shortcut="⌘W">
                  <button
                    className={styles.closeButton}
                    onClick={(e) => handleClose(e, tab.id)}
                  >
                    ✕
                  </button>
                </Tooltip>
              )}
            </div>
          )
        })}
      </div>

      <Tooltip label="New terminal" shortcut="⌘T">
        <button className={styles.newTabButton} onClick={createTerminalForActiveWorkspace}>
          +
        </button>
      </Tooltip>

      <div className={styles.dragSpacer} />
    </div>
  )
}
