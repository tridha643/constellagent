import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { useAppStore } from './store/app-store'
import { SidePanelHost } from './components/SidePanelHost/SidePanelHost'
import { TabBar } from './components/TabBar/TabBar'
import { FileTabSplitContainer, TerminalSplitContainer } from './components/Terminal/TerminalSplitContainer'
import { FileEditor } from './components/Editor/FileEditor'
import { PatchViewerMain } from './components/patch-viewer/PatchViewerMain'
import { FullFileDiffEditor } from './components/Editor/FullFileDiffEditor'
import { MarkdownPreview } from './components/MarkdownPreview/MarkdownPreview'
import { ServicePanel } from './components/Service/ServicePanel'
import { ConductorChatView } from './components/Conductor/ConductorChatView'
import { QuickOpen } from './components/QuickOpen/QuickOpen'
import { ChangesFileFind } from './components/QuickOpen/ChangesFileFind'

// Overlay/modal routes that are never part of first paint (opened only on
// explicit user action). Code-split them so their bundles — and heavy
// transitive deps like linear-api — are parsed on first open, not at startup.
const SettingsPanel = lazy(() =>
  import('./components/Settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
)
const AutomationsPanel = lazy(() =>
  import('./components/Automations/AutomationsPanel').then((m) => ({ default: m.AutomationsPanel })),
)
const LinearWorkspacePanel = lazy(() =>
  import('./components/LinearWorkspace/LinearWorkspacePanel').then((m) => ({ default: m.LinearWorkspacePanel })),
)
const PlanPalette = lazy(() =>
  import('./components/PlanPalette/PlanPalette').then((m) => ({ default: m.PlanPalette })),
)
import { FloatingPanel } from './components/FloatingPanel/FloatingPanel'
import { ConfirmDialog } from './components/Sidebar/ConfirmDialog'
import { ToastContainer } from './components/Toast/Toast'
import { SpotlightHost } from './components/Spotlight/SpotlightHost'
import { AddToChatButton } from './components/AddToChatButton/AddToChatButton'
import { useShortcuts } from './hooks/useShortcuts'
import { usePrStatusPoller } from './hooks/usePrStatusPoller'
import { useWorkspaceBarStats } from './hooks/useWorkspaceBarStats'
import { useWorktreeSyncPoller } from './hooks/useWorktreeSyncPoller'
import { useContextWindowPoller } from './hooks/useContextWindowPoller'
import { useGraphiteStackPoller } from './hooks/useGraphiteStackPoller'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import { applyAppearanceTheme } from './theme/appearance'
import { markPaint } from './utils/perf'
import { playAgentDoneChime } from './lib/play-chime'
import styles from './App.module.css'

/** Hard caps were 400/500px and felt locked on wide layouts; still reserve space for the center pane. */
function sidePanelMaxSizePx(projectOnly: boolean, viewportWidth: number): number {
  const absCap = projectOnly ? 1200 : 2400
  const viewportCap = Math.max(320, viewportWidth - 280)
  return Math.min(absCap, viewportCap)
}

export function App() {
  useShortcuts()
  usePrStatusPoller()
  useWorkspaceBarStats()
  useWorktreeSyncPoller()
  useContextWindowPoller()
  useGraphiteStackPoller()

  // Listen for workspace notification signals from Claude Code hooks
  useEffect(() => {
    const unsub = window.api.claude.onNotifyWorkspace((workspaceId: string) => {
      const state = useAppStore.getState()
      if (workspaceId !== state.activeWorkspaceId) {
        state.markWorkspaceUnread(workspaceId)
        if (state.settings.playAgentDoneChime) playAgentDoneChime()
      }
    })
    return unsub
  }, [])

  // When the iPhone starts a Conductor session, mirror the desktop UI focus.
  useEffect(() => {
    const unsub = window.api.mobile.onFocusSession(({ sessionId, workspaceId, title }) => {
      const state = useAppStore.getState()
      if (state.workspaces.some((workspace) => workspace.id === workspaceId)) {
        state.setActiveWorkspace(workspaceId)
      }
      state.openConductorSessionTab(sessionId, title)
    })
    return unsub
  }, [])

  // When the iPhone creates a managed git worktree, register it in the desktop sidebar.
  useEffect(() => {
    const unsub = window.api.mobile.onWorkspaceCreated(({ project, workspace }) => {
      const state = useAppStore.getState()
      if (!state.projects.some((entry) => entry.id === project.id)) {
        state.addProject(project)
      }
      if (!state.workspaces.some((entry) => entry.id === workspace.id)) {
        state.addWorkspace(workspace)
      } else {
        state.setActiveWorkspace(workspace.id)
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
          if (state.settings.playAgentDoneChime) playAgentDoneChime()
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

  // Service tabs only learn their final status from the PTY exit broadcast — there's no
  // running/exited toggle on the JS side, so we have to listen here and flip the matching tab.
  useEffect(() => {
    return window.api.pty.onExit(async ({ ptyId, exitCode }) => {
      useAppStore.getState().handleSideTerminalClientExit(ptyId)
      const { classifyExit } = await import('@shared/service-types')
      const status = classifyExit(exitCode)
      useAppStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.type === 'service' && t.ptyId === ptyId
            ? { ...t, status, exitCode }
            : t,
        ),
      }))
    })
  }, [])

  useEffect(() => {
    return window.api.git.onWorktreeSyncStatus((event) => {
      useAppStore.getState().setWorktreeSyncStatus(event.projectId, event.workspaces)
    })
  }, [])

  // Main process broadcasts Spotlight state machine transitions; mirror into the
  // store so the sidebar dot / glow / toasts can subscribe without polling.
  useEffect(() => {
    return window.api.spotlight.onStatus((status) => {
      useAppStore.getState().setSpotlightStatus(status)
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
  const rightSidebarBottomPanel = useAppStore((s) => s.rightSidebarBottomPanel)
  const setSidePanelOpen = useAppStore((s) => s.setSidePanelOpen)
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
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  const leftSplitPaneSizes = useMemo(() => {
    const projectOnly = sidePanels.left.panelOrder.includes('project') && sidePanels.left.panelOrder.length === 1
    return {
      minSize: 160,
      maxSize: sidePanelMaxSizePx(projectOnly, viewportWidth),
      preferredSize: projectOnly ? 220 : 280,
    }
  }, [sidePanels.left.panelOrder, viewportWidth])

  const rightSplitPaneSizes = useMemo(() => {
    const projectOnly = sidePanels.right.panelOrder.includes('project') && sidePanels.right.panelOrder.length === 1
    const terminalActive = rightSidebarBottomPanel === 'terminal'
    return {
      minSize: terminalActive ? 360 : projectOnly ? 160 : 240,
      maxSize: sidePanelMaxSizePx(projectOnly, viewportWidth),
      preferredSize: terminalActive ? 520 : projectOnly ? 220 : 280,
    }
  }, [rightSidebarBottomPanel, sidePanels.right.panelOrder, viewportWidth])

  /** Allotment pane order is fixed: [left, center, right]. Snap-drag collapses side panes to match store `open`. */
  const onAllotmentVisibleChange = useCallback(
    (index: number, visible: boolean) => {
      if (index === 0) setSidePanelOpen('left', visible)
      else if (index === 2) setSidePanelOpen('right', visible)
    },
    [setSidePanelOpen],
  )

  // Keep PTY processes alive in main, but only mount the active terminal UI.
  // Inactive xterm DOM trees are expensive and can starve new terminal setup
  // under heavy mixed-tab load; TerminalPanel rehydrates from the main PTY ring.
  const mountedTerminals = allTabs.filter((t): t is Extract<typeof t, { type: 'terminal' }> => (
    t.type === 'terminal' && t.id === activeTabId
  ))
  // Keep every service tab mounted so PTY output streams while the user is on another tab —
  // a `bun dev` log can't go to /dev/null just because the user clicked into the editor.
  const mountedServices = allTabs.filter((t): t is Extract<typeof t, { type: 'service' }> => (
    t.type === 'service'
  ))
  const mountedConductorTabs = allTabs.filter((t): t is Extract<typeof t, { type: 'conductor' }> => (
    t.type === 'conductor'
  ))
  // All file tabs — kept mounted so unsaved edits, scroll position, cursor,
  // selection, and undo stack survive tab switches (mirrors terminal pattern).
  const allFileTabs = allTabs.filter((t): t is Extract<typeof t, { type: 'file' }> => t.type === 'file')
  // Keep diff tabs mounted so scroll position and loaded Pierre diffs survive tab switches.
  const allDiffTabs = allTabs.filter((t): t is Extract<typeof t, { type: 'diff' }> => t.type === 'diff')

  return (
    <MotionConfig reducedMotion="user">
    <div className={styles.app}>
      <div className={styles.layout}>
        {settingsOpen ? (
          <Suspense fallback={null}>
            <SettingsPanel />
          </Suspense>
        ) : automationsOpen ? (
          <Suspense fallback={null}>
            <AutomationsPanel />
          </Suspense>
        ) : linearPanelOpen ? (
          <Suspense fallback={null}>
            <LinearWorkspacePanel />
          </Suspense>
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
                  {/* Mount only active terminal UI; PTYs and recent output stay alive in main. */}
                  {mountedTerminals.map((t) => {
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

                  {/* Service tabs stay mounted so log output keeps streaming when inactive. */}
                  {mountedServices.map((t) => (
                    <ServicePanel
                      key={t.id}
                      tabId={t.id}
                      ptyId={t.ptyId}
                      scriptName={t.scriptName}
                      command={t.command}
                      status={t.status}
                      exitCode={t.exitCode}
                      active={t.id === activeTabId}
                    />
                  ))}

                  {mountedConductorTabs.map((t) => {
                    const ws = workspaces.find((w) => w.id === t.workspaceId)
                    if (!ws) return null
                    return (
                      <ErrorBoundary
                        key={t.id}
                        fallback={
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 14, padding: 24, textAlign: 'center' }}>
                            Conductor hit an error. Reload the window (⌘R) or restart dev.
                          </div>
                        }
                      >
                        <ConductorChatView
                          tab={t}
                          workspaceId={ws.id}
                          worktreePath={ws.worktreePath}
                          active={t.id === activeTabId}
                        />
                      </ErrorBoundary>
                    )
                  })}

                  {/* Keep ALL file editor tabs alive so unsaved edits, cursor,
                      scroll position, and undo stack survive tab switches */}
                  {allFileTabs.map((t) => {
                    const ws = workspaces.find((w) => w.id === t.workspaceId)
                    const isActive = t.id === activeTabId
                    if (t.splitRoot) {
                      return (
                        <FileTabSplitContainer
                          key={t.id}
                          tab={t}
                          active={isActive}
                          worktreePath={ws?.worktreePath}
                        />
                      )
                    }
                    return (
                      <FileEditor
                        key={t.id}
                        tabId={t.id}
                        filePath={t.filePath}
                        active={isActive}
                        worktreePath={ws?.worktreePath}
                      />
                    )
                  })}

                  {allDiffTabs.map((t) => {
                    const ws = workspaces.find((w) => w.id === t.workspaceId)
                    if (!ws) return null
                    return (
                      <ErrorBoundary
                        key={t.id}
                        fallback={
                          <div className={styles.diffViewerError}>
                            Couldn&apos;t load changes. Reload the window (⌘R) or switch tabs and try again.
                          </div>
                        }
                      >
                        <PatchViewerMain
                          variant="tab"
                          worktreePath={ws.worktreePath}
                          active={t.id === activeTabId}
                        />
                      </ErrorBoundary>
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
                      {/* File and diff editors are rendered above (mount-all pattern). */}

                      {/* Render full-file (VS Code-style) diff viewer */}
                      {activeTab?.type === 'fileDiff' && workspace && (
                        <FullFileDiffEditor
                          key={activeTab.id}
                          filePath={activeTab.filePath}
                          worktreePath={workspace.worktreePath}
                          status={activeTab.status}
                          originalRef={activeTab.originalRef}
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
          </ErrorBoundary>
        )}
      </div>
      {quickOpenVisible && workspace && (
        <QuickOpen worktreePath={workspace.worktreePath} />
      )}
      {changesFileFind && <ChangesFileFind />}
      {planPaletteVisible && workspace && (
        <Suspense fallback={null}>
          <PlanPalette worktreePath={workspace.worktreePath} projectWorktrees={planProjectWorktrees} />
        </Suspense>
      )}
      {hunkReviewOpen && hunkReviewWorkspaceId && (() => {
        const reviewWs = workspaces.find((w) => w.id === hunkReviewWorkspaceId)
        return reviewWs ? (
          <PatchViewerMain variant="drawer" worktreePath={reviewWs.worktreePath} />
        ) : null
      })()}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          destructive={confirmDialog.destructive}
          tip={confirmDialog.tip}
          loading={confirmDialog.loading}
          confirmInPlace={confirmDialog.confirmInPlace}
          onConfirm={confirmDialog.onConfirm}
          onCancel={dismissConfirmDialog}
          secondaryConfirmLabel={confirmDialog.secondaryConfirmLabel}
          onSecondaryConfirm={confirmDialog.onSecondaryConfirm}
        />
      )}
      <AddToChatButton />
      <ToastContainer />
      <SpotlightHost />
    </div>
    </MotionConfig>
  )
}
