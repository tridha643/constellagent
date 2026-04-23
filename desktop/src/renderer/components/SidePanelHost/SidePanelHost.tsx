import {
  ChevronsDownUp,
  FileDiff,
  FilePlus,
  FolderTree,
  GitBranch,
  LayoutList,
  Search,
} from 'lucide-react'
import { useCallback, useMemo, useState, type ComponentType, type DragEvent } from 'react'
import { useAppStore } from '../../store/app-store'
import type { PanelType, Side } from '../../store/types'
import { panelLabel } from '../../store/side-panels'
import { Sidebar } from '../Sidebar/Sidebar'
import { FileTree } from '../RightPanel/FileTree'
import { ChangedFiles } from '../RightPanel/ChangedFiles'
import { GitGraph } from '../RightPanel/GitGraph'
import { fileTreeActions } from '../RightPanel/file-tree-actions'
import { Tooltip } from '../Tooltip/Tooltip'
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary'
import { readPanelDockDrag, writePanelDockDrag } from '../../utils/panel-dnd'
import styles from './SidePanelHost.module.css'

const PANEL_SHORTCUTS: Partial<Record<PanelType, string>> = {
  files: '⇧⌘E',
  changes: '⇧⌘G',
  graph: '⌥⌘G',
}

const PANEL_ICONS: Record<PanelType, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  files: FolderTree,
  changes: FileDiff,
  graph: GitBranch,
  project: LayoutList,
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

  const solePanel = panelState.panelOrder.length === 1 ? panelState.panelOrder[0] : null
  const showSwitchers = panelState.panelOrder.length > 1
  const canAcceptDock = Boolean(panelDockDrag && panelDockDrag.side !== side)
  const dockPanelName = panelDockDrag ? panelLabel(panelDockDrag.panel) : 'panel'

  const showFilesTools = activePanel === 'files'

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
      data-panel-dock-drag-active={panelDockDrag ? 'true' : 'false'}
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
      <div
        className={[
          styles.explorerRow,
          solePanel && draggingPanel === solePanel ? styles.modeButtonDragging : '',
        ].filter(Boolean).join(' ')}
        {...(solePanel
          ? {
              draggable: true,
              'data-panel-type': solePanel,
              'data-testid':
                solePanel === 'project'
                  ? 'side-panel-tab-project'
                  : `right-panel-mode-${solePanel === 'graph' ? 'graph' : solePanel}`,
              'aria-label': `Drag to dock ${panelLabel(solePanel)}`,
              title: `Drag to dock ${panelLabel(solePanel)} to the other sidebar`,
              onDragStart: (event: DragEvent) => {
                setDraggingPanel(solePanel)
                const payload = { panel: solePanel, side }
                setPanelDockDrag(payload)
                writePanelDockDrag(event.dataTransfer, payload)
              },
              onDragEnd: () => {
                setDraggingPanel(null)
                setDockHovered(false)
                setPanelDockDrag(null)
              },
            }
          : {})}
      >
        <div className={styles.explorerSpacer} aria-hidden="true" />
        <div className={styles.explorerToolbar}>
          {showFilesTools && (
            <div className={styles.explorerTools}>
              <Tooltip label="Search files" shortcut="⌘P">
                <button
                  type="button"
                  className={styles.iconButton}
                  data-testid="explorer-action-search"
                  onClick={() => fileTreeActions.emit('focusSearch')}
                >
                  <Search size={14} strokeWidth={2} />
                </button>
              </Tooltip>
              <Tooltip label="Collapse folders">
                <button
                  type="button"
                  className={styles.iconButton}
                  data-testid="explorer-action-collapse"
                  onClick={() => fileTreeActions.emit('collapseAll')}
                >
                  <ChevronsDownUp size={14} strokeWidth={2} />
                </button>
              </Tooltip>
              <Tooltip label="New file">
                <button
                  type="button"
                  className={styles.iconButton}
                  data-testid="explorer-action-new-file"
                  onClick={() => fileTreeActions.emit('newFile')}
                >
                  <FilePlus size={14} strokeWidth={2} />
                </button>
              </Tooltip>
            </div>
          )}

          {showSwitchers && (
            <div
              className={styles.explorerActions}
              data-testid="right-panel-mode-toggle"
            >
              {panelState.panelOrder.map((panel) => {
                const Icon = PANEL_ICONS[panel]
                const isActive = activePanel === panel
                const button = (
                  <button
                    key={panel}
                    type="button"
                    draggable
                    aria-label={panelLabel(panel)}
                    aria-pressed={isActive}
                    data-panel-type={panel}
                    data-testid={panel === 'project' ? 'side-panel-tab-project' : `right-panel-mode-${panel === 'graph' ? 'graph' : panel}`}
                    className={[
                      styles.iconButton,
                      styles.panelIconButton,
                      isActive ? styles.active : '',
                      draggingPanel === panel ? styles.modeButtonDragging : '',
                    ].filter(Boolean).join(' ')}
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
                    <Icon size={14} strokeWidth={2} />
                    <span className={styles.visuallyHidden}>{panelLabel(panel)}</span>
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
          )}
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
          <ErrorBoundary
            key={`${side}:${activePanel}:${workspace?.id ?? 'no-workspace'}:${workspace?.worktreePath ?? ''}`}
            fallback={
              <div className={styles.panelError}>
                <span className={styles.panelErrorText}>
                  This sidebar panel hit a rendering error. Switch workspace or tab, or reload the window (⌘R).
                </span>
              </div>
            }
          >
            <div className={styles.tabBody}>
              {renderPanel(activePanel, workspace ? { id: workspace.id, worktreePath: workspace.worktreePath } : undefined)}
            </div>
          </ErrorBoundary>
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
