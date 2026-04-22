import { useCallback, useMemo, useState, type DragEvent } from 'react'
import { useAppStore } from '../../store/app-store'
import type { PanelType, Side } from '../../store/types'
import { panelLabel } from '../../store/side-panels'
import { Sidebar } from '../Sidebar/Sidebar'
import { FileTree } from '../RightPanel/FileTree'
import { ChangedFiles } from '../RightPanel/ChangedFiles'
import { GitGraph } from '../RightPanel/GitGraph'
import { Tooltip } from '../Tooltip/Tooltip'
import { readPanelDockDrag, writePanelDockDrag } from '../../utils/panel-dnd'
import styles from './SidePanelHost.module.css'

const PANEL_SHORTCUTS: Partial<Record<PanelType, string>> = {
  files: '⇧⌘E',
  changes: '⇧⌘G',
  graph: '⌥⌘G',
}

function SidePanelEmptyState({
  icon,
  title,
  text,
}: {
  icon: string
  title: string
  text: string
}) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}>{icon}</span>
      <span className={styles.emptyTitle}>{title}</span>
      <span className={styles.emptyText}>{text}</span>
    </div>
  )
}

function renderPanel(panel: PanelType, workspace: { id: string; worktreePath: string } | undefined) {
  if (panel === 'project') {
    return <Sidebar embedded showTitleArea={false} />
  }
  if (!workspace) {
    return (
      <SidePanelEmptyState
        icon="📁"
        title="No workspace selected"
        text="Pick a workspace to browse files, inspect changes, and move through git history."
      />
    )
  }
  if (panel === 'files') {
    return <FileTree worktreePath={workspace.worktreePath} isActive />
  }
  if (panel === 'changes') {
    return <ChangedFiles worktreePath={workspace.worktreePath} workspaceId={workspace.id} isActive />
  }
  return <GitGraph worktreePath={workspace.worktreePath} workspaceId={workspace.id} isActive />
}

export function SidePanelHost({ side }: { side: Side }) {
  const panelState = useAppStore((s) => s.sidePanels[side])
  const panelDockDrag = useAppStore((s) => s.panelDockDrag)
  const setSidePanelActive = useAppStore((s) => s.setSidePanelActive)
  const movePanelToSide = useAppStore((s) => s.movePanelToSide)
  const setPanelDockDrag = useAppStore((s) => s.setPanelDockDrag)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const workspaces = useAppStore((s) => s.workspaces)
  const [dockHovered, setDockHovered] = useState(false)
  const [draggingPanel, setDraggingPanel] = useState<PanelType | null>(null)

  const workspace = useMemo(
    () => workspaces.find((entry) => entry.id === activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  )

  const activePanel = panelState.panelOrder.includes(panelState.activePanel)
    ? panelState.activePanel
    : panelState.panelOrder[0]

  const showsNavigationTabs = panelState.panelOrder.some((panel) => panel === 'files' || panel === 'changes' || panel === 'graph')
  const canAcceptDock = Boolean(panelDockDrag && panelDockDrag.side !== side)
  const dockPanelName = panelDockDrag ? panelLabel(panelDockDrag.panel) : 'panel'

  const resolveDragPayload = useCallback((event: DragEvent) => {
    return readPanelDockDrag(event.dataTransfer) ?? panelDockDrag
  }, [panelDockDrag])

  const handleDockDragOver = useCallback((event: DragEvent) => {
    const payload = resolveDragPayload(event)
    if (!payload || payload.side === side) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!dockHovered) setDockHovered(true)
  }, [dockHovered, resolveDragPayload, side])

  const handleDockDragLeave = useCallback((event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setDockHovered(false)
  }, [])

  const handleDockDrop = useCallback((event: DragEvent) => {
    const payload = resolveDragPayload(event)
    if (!payload || payload.side === side) return
    event.preventDefault()
    movePanelToSide(payload.panel, side)
    setDockHovered(false)
    setPanelDockDrag(null)
    setDraggingPanel(null)
  }, [movePanelToSide, resolveDragPayload, setPanelDockDrag, side])

  return (
    <div
      className={[
        styles.host,
        side === 'left' ? styles.left : styles.right,
        canAcceptDock ? styles.hostDockReady : '',
        dockHovered ? styles.hostDockHovered : '',
      ].filter(Boolean).join(' ')}
      data-panel-side={side}
      data-active-panel={activePanel ?? ''}
      data-panel-drop-target-side={side}
      data-panel-dock-state={dockHovered ? 'hovered' : canAcceptDock ? 'ready' : 'idle'}
      data-testid={side === 'right' ? 'right-panel' : `side-panel-${side}`}
      onDragEnter={handleDockDragOver}
      onDragOver={handleDockDragOver}
      onDragLeave={handleDockDragLeave}
      onDrop={handleDockDrop}
    >
      {side === 'left' && <div className={styles.titleArea} />}

      <div className={styles.header}>
        <div
          className={styles.modeToggle}
          data-testid={showsNavigationTabs ? 'right-panel-mode-toggle' : undefined}
        >
          {panelState.panelOrder.map((panel) => {
            const button = (
              <button
                key={panel}
                draggable
                data-panel-type={panel}
                data-testid={panel === 'project' ? 'side-panel-tab-project' : `right-panel-mode-${panel === 'graph' ? 'graph' : panel}`}
                className={`${styles.modeButton} ${activePanel === panel ? styles.active : ''} ${draggingPanel === panel ? styles.modeButtonDragging : ''}`}
                onClick={() => setSidePanelActive(side, panel)}
                onDragStart={(event) => {
                  setDraggingPanel(panel)
                  const payload = { panel, side }
                  setPanelDockDrag(payload)
                  writePanelDockDrag(event.dataTransfer, payload)
                }}
                onDragEnd={() => {
                  setDraggingPanel(null)
                  setDockHovered(false)
                  setPanelDockDrag(null)
                }}
              >
                {panelLabel(panel)}
              </button>
            )

            const shortcut = PANEL_SHORTCUTS[panel]
            const tooltipLabel = `Drag to dock ${panelLabel(panel)} to the other sidebar`
            if (!shortcut) {
              return (
                <Tooltip key={panel} label={tooltipLabel}>
                  {button}
                </Tooltip>
              )
            }
            return (
              <Tooltip key={panel} label={tooltipLabel} shortcut={shortcut}>
                {button}
              </Tooltip>
            )
          })}
        </div>
      </div>

      <div className={styles.content}>
        {panelState.panelOrder.length === 0 || !activePanel ? (
          <SidePanelEmptyState
            icon="🧩"
            title="No panels assigned"
            text="Use Settings to choose which sidebar should host project navigation versus files, changes, and git history."
          />
        ) : (
          <div key={`${side}:${activePanel}`} className={styles.tabBody}>
            {renderPanel(activePanel, workspace ? { id: workspace.id, worktreePath: workspace.worktreePath } : undefined)}
          </div>
        )}
      </div>

      {canAcceptDock && (
        <div className={styles.dockOverlay} aria-hidden="true">
          <div className={styles.dockOverlayInner}>
            <span className={styles.dockOverlayBadge}>{side === 'left' ? '⟵' : '⟶'}</span>
            <span className={styles.dockOverlayTitle}>Dock {dockPanelName}</span>
            <span className={styles.dockOverlayText}>Drop anywhere to slam it into the {side} sidebar.</span>
          </div>
        </div>
      )}
    </div>
  )
}
