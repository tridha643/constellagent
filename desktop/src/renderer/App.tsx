import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { MotionConfig } from 'framer-motion'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { useAppStore } from './store/app-store'
import { SidePanelHost } from './components/SidePanelHost/SidePanelHost'
import { TabBar } from './components/TabBar/TabBar'
import { FileTabSplitContainer, TerminalSplitContainer } from './components/Terminal/TerminalSplitContainer'
import { FileEditor } from './components/Editor/FileEditor'
import { DiffViewer } from './components/Editor/DiffEditor'
import { MarkdownPreview } from './components/MarkdownPreview/MarkdownPreview'
import { T3CodeView } from './components/T3CodeView/T3CodeView'
import { PiThreadPanel } from './components/PiThread/PiThreadPanel'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { AutomationsPanel } from './components/Automations/AutomationsPanel'
import { LinearWorkspacePanel } from './components/LinearWorkspace/LinearWorkspacePanel'
import { QuickOpen } from './components/QuickOpen/QuickOpen'
import { ChangesFileFind } from './components/QuickOpen/ChangesFileFind'
import { PlanPalette } from './components/PlanPalette/PlanPalette'
import { HunkReview } from './components/HunkReview/HunkReview'
import { FloatingPanel } from './components/FloatingPanel/FloatingPanel'
import { ConfirmDialog } from './components/Sidebar/ConfirmDialog'
import { ToastContainer } from './components/Toast/Toast'
import { AddToChatButton } from './components/AddToChatButton/AddToChatButton'
import { useShortcuts } from './hooks/useShortcuts'
import { usePrStatusPoller } from './hooks/usePrStatusPoller'
import { useWorktreeSyncPoller } from './hooks/useWorktreeSyncPoller'
import { useContextWindowPoller } from './hooks/useContextWindowPoller'
import { useGraphiteStackPoller } from './hooks/useGraphiteStackPoller'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import { applyAppearanceTheme } from './theme/appearance'
import { markPaint } from './utils/perf'
import { panelLabel } from './store/side-panels'
import type { Side } from './store/types'
import { readPanelDockDrag } from './utils/panel-dnd'
import styles from './App.module.css'

function DockEdgeTarget({
  side,
  active,
  label,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  side: Side
  active: boolean
  label: string
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className={`${styles.dockEdgeTarget} ${side === 'left' ? styles.dockEdgeLeft : styles.dockEdgeRight} ${active ? styles.dockEdgeTargetActive : ''}`}
      data-testid={`panel-dock-edge-${side}`}
      data-panel-dock-edge-side={side}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className={styles.dockEdgeRail} />
      <div className={styles.dockEdgeLabel}>{label}</div>
    </div>
  )
}

export function App() {
  useShortcuts()
  usePrStatusPoller()
  useWorktreeSyncPoller()
  useContextWindowPoller()
  useGraphiteStackPoller()

  // Listen for workspace notification signals from Claude Code hooks
  useEffect(() => {
    const unsub = window.api.claude.onNotifyWorkspace((workspaceId: string) => {
      const state = useAppStore.getState()
      if (workspaceId !== state.activeWorkspaceId) {
        state.markWorkspaceUnread(workspaceId)
      }
    })
    return unsub
  }, [])

  // Listen for agent activity updates (Claude hooks + Codex submit/notify markers)
  useEffect(() => {
    let prevActive = new Set<string>()
    const unsub = window.api.claude.onActivityUpdate((entries) => {
      const nextActive = new Set(entries.map((e) => e.wsId))
      const state = useAppStore.getState()

      for (const wsId of prevActive) {
        if (!nextActive.has(wsId) && wsId !== state.activeWorkspaceId && state.workspaces.some((w) => w.id === wsId)) {
          state.markWorkspaceUnread(wsId)
        }
      }

      state.setActiveAgentWorkspaces(entries)
      prevActive = nextActive
    })
    return unsub
  }, [])

  // Listen for agent type detection from PTY (claude, codex, gemini, cursor, opencode)
  useEffect(() => {
    return window.api.pty.onAgentDetected(({ ptyId, agentType }) => {
      useAppStore.getState().setTerminalAgentType(ptyId, agentType as import('./store/types').AgentType)
    })
  }, [])

  // Listen for OSC title changes from PTY (agent session topics)
  useEffect(() => {
    return window.api.pty.onTitleChanged(({ ptyId, title }) => {
      console.log('[constellagent:tab-title] renderer IPC PTY_TITLE_CHANGED', { ptyId, title: title.slice(0, 80) })
      useAppStore.getState().updateTerminalTitle(ptyId, title)
    })
  }, [])

  useEffect(() => {
    return window.api.git.onWorktreeSyncStatus((event) => {
      useAppStore.getState().setWorktreeSyncStatus(event.projectId, event.workspaces)
    })
  }, [])

  // Re-merge `git worktree list` when returning to the app so CLI-created worktrees appear in the sidebar.
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        useAppStore.getState().refreshGitWorktrees()
      }, 400)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule()
    }
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (debounce) clearTimeout(debounce)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const allTabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const sidePanels = useAppStore((s) => s.sidePanels)
  const panelDockDrag = useAppStore((s) => s.panelDockDrag)
  const movePanelToSide = useAppStore((s) => s.movePanelToSide)
  const setSidePanelOpen = useAppStore((s) => s.setSidePanelOpen)
  const setPanelDockDrag = useAppStore((s) => s.setPanelDockDrag)
  const activeWorkspaceTabs = useAppStore((s) => s.activeWorkspaceTabs)
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const automationsOpen = useAppStore((s) => s.automationsOpen)
  const linearPanelOpen = useAppStore((s) => s.linearPanelOpen)
  const quickOpenVisible = useAppStore((s) => s.quickOpenVisible)
  const changesFileFind = useAppStore((s) => s.changesFileFind)
  const planPaletteVisible = useAppStore((s) => s.planPaletteVisible)
  const hunkReviewOpen = useAppStore((s) => s.hunkReviewOpen)
  const hunkReviewWorkspaceId = useAppStore((s) => s.hunkReviewWorkspaceId)
  const confirmDialog = useAppStore((s) => s.confirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const switchStartedAtRef = useRef<number | null>(null)
  const prevWorkspaceIdRef = useRef<string | null>(null)
  const [dockEdgeHover, setDockEdgeHover] = useState<Side | null>(null)

  useEffect(() => {
    applyAppearanceTheme(appearanceThemeId)
  }, [appearanceThemeId])

  const wsTabs = activeWorkspaceTabs()
  const activeTab = wsTabs.find((t) => t.id === activeTabId)
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const planProjectWorktrees = useMemo(() => {
    if (!workspace) return []
    return workspaces
      .filter((w) => w.projectId === workspace.projectId)
      .map((w) => ({
        path: w.worktreePath,
        label: w.name || w.branch || w.worktreePath.split('/').filter(Boolean).pop() || w.worktreePath,
      }))
  }, [workspaces, workspace])
  const tabWorkspace = activeTab
    ? workspaces.find((w) => w.id === activeTab.workspaceId)
    : undefined

  useEffect(() => {
    if (prevWorkspaceIdRef.current === activeWorkspaceId) return
    prevWorkspaceIdRef.current = activeWorkspaceId
    switchStartedAtRef.current = performance.now()
  }, [activeWorkspaceId])

  useEffect(() => {
    const startedAt = switchStartedAtRef.current
    if (startedAt == null) return
    markPaint('workspace-switch', startedAt, {
      activeWorkspaceId,
      activeTabId,
      activeTabType: activeTab?.type ?? 'none',
      sidePanels,
    })
    switchStartedAtRef.current = null
  }, [activeWorkspaceId, activeTabId, activeTab?.type, sidePanels])

  useEffect(() => {
    if (!panelDockDrag) setDockEdgeHover(null)
  }, [panelDockDrag])

  const resolvePanelDockPayload = useCallback((event: DragEvent<HTMLDivElement>) => {
    return readPanelDockDrag(event.dataTransfer) ?? panelDockDrag
  }, [panelDockDrag])

  const handleDockEdgeDragOver = useCallback((side: Side, event: DragEvent<HTMLDivElement>) => {
    const payload = resolvePanelDockPayload(event)
    if (!payload || payload.side === side) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dockEdgeHover !== side) setDockEdgeHover(side)
  }, [dockEdgeHover, resolvePanelDockPayload])

  const handleDockEdgeDragLeave = useCallback((side: Side, event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setDockEdgeHover((current) => (current === side ? null : current))
  }, [])

  const handleDockEdgeDrop = useCallback((side: Side, event: DragEvent<HTMLDivElement>) => {
    const payload = resolvePanelDockPayload(event)
    if (!payload || payload.side === side) return
    event.preventDefault()
    movePanelToSide(payload.panel, side)
    setDockEdgeHover(null)
    setPanelDockDrag(null)
  }, [movePanelToSide, resolvePanelDockPayload, setPanelDockDrag])

  const leftSplitPaneSizes = useMemo(() => {
    const projectOnly = sidePanels.left.panelOrder.includes('project') && sidePanels.left.panelOrder.length === 1
    return {
      minSize: 160,
      maxSize: projectOnly ? 400 : 500,
      preferredSize: projectOnly ? 220 : 280,
    }
  }, [sidePanels.left.panelOrder])

  const rightSplitPaneSizes = useMemo(() => {
    const projectOnly = sidePanels.right.panelOrder.includes('project') && sidePanels.right.panelOrder.length === 1
    return {
      minSize: projectOnly ? 160 : 240,
      maxSize: projectOnly ? 400 : 500,
      preferredSize: projectOnly ? 220 : 280,
    }
  }, [sidePanels.right.panelOrder])

  /** Allotment pane order is fixed: [left, center, right]. Snap-drag collapses side panes to match store `open`. */
  const onAllotmentVisibleChange = useCallback(
    (index: number, visible: boolean) => {
      if (index === 0) setSidePanelOpen('left', visible)
      else if (index === 2) setSidePanelOpen('right', visible)
    },
    [setSidePanelOpen],
  )

  // All terminal tabs across every workspace — kept alive to preserve PTY state
  const allTerminals = allTabs.filter((t): t is Extract<typeof t, { type: 'terminal' }> => t.type === 'terminal')

  return (
    <MotionConfig reducedMotion="user">
    <div className={styles.app}>
      <div className={styles.layout}>
        {settingsOpen ? (
          <SettingsPanel />
        ) : automationsOpen ? (
          <AutomationsPanel />
        ) : linearPanelOpen ? (
          <LinearWorkspacePanel />
        ) : (
          <ErrorBoundary
            fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 14 }}>
                Something went wrong. Try reloading the window (⌘R).
              </div>
            }
          >
          <Allotment onVisibleChange={onAllotmentVisibleChange}>
            <Allotment.Pane
              visible={sidePanels.left.open}
              snap
              minSize={leftSplitPaneSizes.minSize}
              maxSize={leftSplitPaneSizes.maxSize}
              preferredSize={leftSplitPaneSizes.preferredSize}
            >
              <div className={`${styles.sidePanelShell} ${styles.sidePanelShellLeft}`}>
                <SidePanelHost side="left" />
              </div>
            </Allotment.Pane>

            {/* Center — no snap so it cannot be collapsed by dragging */}
            <Allotment.Pane minSize={240}>
              <div className={styles.centerPanel}>
                <TabBar />
                <div className={styles.contentArea}>
                  {/* Keep ALL terminal panels alive across workspaces so PTY
                      state (scrollback, TUI layout) is never lost */}
                  {allTerminals.map((t) => {
                    const ws = workspaces.find((w) => w.id === t.workspaceId)
                    return (
                      <TerminalSplitContainer
                        key={t.id}
                        tab={t}
                        active={t.id === activeTabId}
                        worktreePath={ws?.worktreePath}
                      />
                    )
                  })}

                  {!activeTab ? (
                    <div className={styles.welcomeWrap}>
                      <FloatingPanel.Surface className={styles.welcome}>
                        <div className={styles.welcomeLogo}>constellagent</div>
                        <div className={styles.welcomeHint}>
                          Add a project to get started, or press
                          <span className={styles.welcomeShortcut}>⌘T</span>
                          for a new terminal
                        </div>
                      </FloatingPanel.Surface>
                    </div>
                  ) : (
                    <>
                      {/* Render active file editor */}
                      {activeTab?.type === 'file' && activeTab.splitRoot && tabWorkspace && (
                        <FileTabSplitContainer
                          key={activeTab.id}
                          tab={activeTab}
                          active={true}
                          worktreePath={tabWorkspace.worktreePath}
                        />
                      )}
                      {activeTab?.type === 'file' && !activeTab.splitRoot && (
                        <FileEditor
                          key={activeTab.id}
                          tabId={activeTab.id}
                          filePath={activeTab.filePath}
                          active={true}
                          worktreePath={tabWorkspace?.worktreePath}
                        />
                      )}

                      {/* Render active diff viewer */}
                      {activeTab?.type === 'diff' && workspace && (
                        <DiffViewer
                          key={activeTab.commitHash || activeTab.id}
                          worktreePath={workspace.worktreePath}
                          active={true}
                          commitHash={activeTab.commitHash}
                          commitMessage={activeTab.commitMessage}
                        />
                      )}

                      {/* Render markdown preview */}
                      {activeTab?.type === 'markdownPreview' && (
                        <MarkdownPreview
                          key={activeTab.id}
                          filePath={activeTab.filePath}
                          worktreePath={tabWorkspace?.worktreePath}
                        />
                      )}

                      {/* Render T3 Code webview */}
                      {activeTab?.type === 't3code' && (
                        <T3CodeView
                          key={activeTab.id}
                          serverUrl={activeTab.serverUrl}
                          active={true}
                        />
                      )}

                      {activeTab?.type === 'pi-thread' && tabWorkspace && (
                        <PiThreadPanel
                          key={activeTab.id}
                          worktreePath={tabWorkspace.worktreePath}
                          workspaceLabel={tabWorkspace.name}
                          active={true}
                          boundSessionId={activeTab.piSessionId}
                          piThreadTabId={activeTab.id}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane
              visible={sidePanels.right.open}
              snap
              minSize={rightSplitPaneSizes.minSize}
              maxSize={rightSplitPaneSizes.maxSize}
              preferredSize={rightSplitPaneSizes.preferredSize}
            >
              <div className={`${styles.sidePanelShell} ${styles.sidePanelShellRight}`}>
                <SidePanelHost side="right" />
              </div>
            </Allotment.Pane>
          </Allotment>
          {panelDockDrag && (
            <>
              {(['left', 'right'] as Side[]).map((side) => (
                panelDockDrag.side === side ? null : (
                  <DockEdgeTarget
                    key={side}
                    side={side}
                    active={dockEdgeHover === side}
                    label={`Dock ${panelLabel(panelDockDrag.panel)} ${side}`}
                    onDragEnter={(event) => handleDockEdgeDragOver(side, event)}
                    onDragLeave={(event) => handleDockEdgeDragLeave(side, event)}
                    onDragOver={(event) => handleDockEdgeDragOver(side, event)}
                    onDrop={(event) => handleDockEdgeDrop(side, event)}
                  />
                )
              ))}
            </>
          )}
          </ErrorBoundary>
        )}
      </div>
      {quickOpenVisible && workspace && (
        <QuickOpen worktreePath={workspace.worktreePath} />
      )}
      {changesFileFind && <ChangesFileFind />}
      {planPaletteVisible && workspace && (
        <PlanPalette worktreePath={workspace.worktreePath} projectWorktrees={planProjectWorktrees} />
      )}
      {hunkReviewOpen && hunkReviewWorkspaceId && (() => {
        const reviewWs = workspaces.find((w) => w.id === hunkReviewWorkspaceId)
        return reviewWs ? <HunkReview worktreePath={reviewWs.worktreePath} /> : null
      })()}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          destructive={confirmDialog.destructive}
          tip={confirmDialog.tip}
          loading={confirmDialog.loading}
          onConfirm={confirmDialog.onConfirm}
          onCancel={dismissConfirmDialog}
          secondaryConfirmLabel={confirmDialog.secondaryConfirmLabel}
          onSecondaryConfirm={confirmDialog.onSecondaryConfirm}
        />
      )}
      <AddToChatButton />
      <ToastContainer />
    </div>
    </MotionConfig>
  )
}
