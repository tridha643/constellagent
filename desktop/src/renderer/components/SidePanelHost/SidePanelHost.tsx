import {
  ChevronsDownUp,
  ChevronDown,
  FileDiff,
  FilePlus,
  FolderTree,
  Globe,
  GripVertical,
  LayoutList,
  MessageSquareMore,
  Plus,
  Search,
} from 'lucide-react'
import { BrowserPanel } from '../BrowserPanel/BrowserPanel'
import { useCallback, useMemo, useState, type ComponentType, type DragEvent } from 'react'
import { useAppStore } from '../../store/app-store'
import type { PanelType, Side } from '../../store/types'
import { panelLabel } from '../../store/side-panels'
import { Sidebar } from '../Sidebar/Sidebar'
import { FileTree } from '../RightPanel/FileTree'
import { ChangedFiles } from '../RightPanel/ChangedFiles'
import { SideChatPanel } from '../SideChatPanel/SideChatPanel'
import { SideTerminalPanel } from '../SideTerminalPanel/SideTerminalPanel'
import { SetupPanel } from './SetupPanel'
import { fileTreeActions } from '../RightPanel/file-tree-actions'
import { Tooltip } from '../Tooltip/Tooltip'
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary'
import { readPanelDockDrag, writePanelDockDrag } from '../../utils/panel-dnd'
import styles from './SidePanelHost.module.css'

const PANEL_SHORTCUTS: Partial<Record<PanelType, string>> = {
  files: '⇧⌘E',
  changes: '⇧⌘G',
}

const PANEL_ICONS: Record<PanelType, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  files: FolderTree,
  changes: FileDiff,
  project: LayoutList,
  browser: Globe,
  sideChat: MessageSquareMore,
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
        text="Pick a workspace to browse files and inspect changes."
      />
    )
  }
  if (panel === 'files') {
    return <FileTree worktreePath={workspace.worktreePath} isActive />
  }
  if (panel === 'changes') {
    return <ChangedFiles worktreePath={workspace.worktreePath} workspaceId={workspace.id} isActive />
  }
  if (panel === 'browser') {
    return <BrowserPanel workspaceId={workspace.id} />
  }
  if (panel === 'sideChat') {
    return <SideChatPanel workspaceId={workspace.id} worktreePath={workspace.worktreePath} />
  }
  return null
}

function RightSidebarBottomDock({ workspace }: { workspace: { id: string; projectId?: string; worktreePath: string } | undefined }) {
  const activeBottomPanel = useAppStore((s) => s.rightSidebarBottomPanel)
  const setActiveBottomPanel = useAppStore((s) => s.setRightSidebarBottomPanel)
  const createSideTerminal = useAppStore((s) => s.createSideTerminalForActiveWorkspace)

  const [collapsed, setCollapsed] = useState(false)

  // Selecting a tab while collapsed should reveal the dock body, not silently
  // switch a hidden panel.
  const selectBottomPanel = (panel: 'setup' | 'terminal') => {
    setActiveBottomPanel(panel)
    setCollapsed(false)
  }

  return (
    <div
      className={`${styles.bottomDock} ${collapsed ? styles.bottomDockCollapsed : ''}`}
      data-testid="right-sidebar-bottom-dock"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className={styles.bottomDockTabs}>
        <button
          type="button"
          className={styles.bottomDockChevron}
          aria-label={collapsed ? 'Expand bottom dock' : 'Collapse bottom dock'}
          aria-expanded={!collapsed}
          data-testid="right-sidebar-bottom-dock-toggle"
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronDown size={15} strokeWidth={2} className={styles.bottomDockChevronIcon} />
        </button>
        {(['setup', 'terminal'] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            className={`${styles.bottomDockTab} ${!collapsed && activeBottomPanel === panel ? styles.bottomDockTabActive : ''}`}
            aria-pressed={!collapsed && activeBottomPanel === panel}
            onClick={() => selectBottomPanel(panel)}
          >
            {panel === 'setup' ? 'Setup' : 'Terminal'}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.bottomDockIconButton} ${styles.bottomDockIconButtonTrailing}`}
          aria-label="New terminal"
          disabled={!workspace}
          onClick={() => {
            selectBottomPanel('terminal')
            void createSideTerminal()
          }}
        >
          <Plus size={15} strokeWidth={2} />
        </button>
      </div>
      {!collapsed && (
      <div className={styles.bottomDockBody}>
        {activeBottomPanel === 'terminal' && workspace ? (
          <SideTerminalPanel workspaceId={workspace.id} />
        ) : (
          <SetupPanel workspace={workspace} />
        )}
      </div>
      )}
    </div>
  )
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

  const beginPanelDrag = useCallback((panel: PanelType) => (event: DragEvent) => {
    setDraggingPanel(panel)
    const payload = { panel, side }
    setPanelDockDrag(payload)
    writePanelDockDrag(event.dataTransfer, payload)
  }, [setPanelDockDrag, side])

  const endPanelDrag = useCallback(() => {
    setDraggingPanel(null)
    setDockHovered(false)
    setPanelDockDrag(null)
  }, [setPanelDockDrag])

  const renderPanelDragHandle = (panel: PanelType) => (
    <Tooltip label={`Drag to dock ${panelLabel(panel)} to the other sidebar`}>
      <span
        className={[
          styles.panelDragHandle,
          draggingPanel === panel ? styles.modeButtonDragging : '',
        ].filter(Boolean).join(' ')}
        draggable
        role="button"
        tabIndex={0}
        aria-label={`Drag to dock ${panelLabel(panel)} to the other sidebar`}
        data-panel-type={panel}
        onDragStart={beginPanelDrag(panel)}
        onDragEnd={endPanelDrag}
      >
        <GripVertical size={10} strokeWidth={2} aria-hidden="true" />
      </span>
    </Tooltip>
  )

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
      <div className={styles.explorerRow}>
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
                const testId = panel === 'project' ? 'side-panel-tab-project' : `right-panel-mode-${panel}`
                const button = (
                  <button
                    type="button"
                    aria-label={panelLabel(panel)}
                    aria-pressed={isActive}
                    data-testid={testId}
                    className={[
                      styles.iconButton,
                      styles.panelIconButton,
                      isActive ? styles.active : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSidePanelActive(side, panel)}
                  >
                    <Icon size={14} strokeWidth={2} />
                    <span className={styles.visuallyHidden}>{panelLabel(panel)}</span>
                  </button>
                )

                const shortcut = PANEL_SHORTCUTS[panel]
                return (
                  <div key={panel} className={styles.panelSwitcherItem}>
                    {shortcut ? (
                      <Tooltip label={panelLabel(panel)} shortcut={shortcut}>
                        {button}
                      </Tooltip>
                    ) : (
                      <Tooltip label={panelLabel(panel)}>
                        {button}
                      </Tooltip>
                    )}
                    {renderPanelDragHandle(panel)}
                  </div>
                )
              })}
            </div>
          )}

          {solePanel && !showSwitchers && (() => {
            const Icon = PANEL_ICONS[solePanel]
            const testId = solePanel === 'project' ? 'side-panel-tab-project' : `right-panel-mode-${solePanel}`
            return (
              <div className={styles.explorerActions}>
                <div className={styles.panelSwitcherItem}>
                  <span
                    className={[styles.iconButton, styles.panelIconButton, styles.active].join(' ')}
                    data-testid={testId}
                    aria-label={panelLabel(solePanel)}
                  >
                    <Icon size={14} strokeWidth={2} />
                    <span className={styles.visuallyHidden}>{panelLabel(solePanel)}</span>
                  </span>
                  {renderPanelDragHandle(solePanel)}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      <div className={styles.content}>
        {panelState.panelOrder.length === 0 || !activePanel ? (
          <SidePanelEmptyState
            icon="🧩"
            title="No panels assigned"
            text="Use Settings to choose which sidebar should host project navigation versus files and changes."
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

      {side === 'right' && (
        <RightSidebarBottomDock
          workspace={workspace ? { id: workspace.id, projectId: workspace.projectId, worktreePath: workspace.worktreePath } : undefined}
        />
      )}

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
