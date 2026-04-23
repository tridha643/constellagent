import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'
import {
  linearWorkspaceViewNext,
  linearWorkspaceViewPrev,
  normalizeLinearWorkspaceTabOrder,
  normalizeLinearWorkspaceView,
  resolveEditor,
} from '../store/types'
import { findSideForPanel } from '../store/side-panels'
import { getFocusedPtyId, isFocusedPaneTerminal, resolveAgentPtyForContextInjection } from '../store/split-helpers'
import {
  sendAddToChatText,
  sendActiveSelectionToAgent,
  findMarkdownPreviewRootForCurrentSelection,
  isPlanSidecarPath,
  openPlanEditSidecar,
} from '../utils/add-to-chat'
import { wrapBracketedPaste } from '../utils/bracketed-paste'
import {
  getFocusedMonacoEditor,
  runMonacoAddToChatIfFocused,
  openQuickOpenFromFocusedEditor,
} from '../utils/add-to-chat-monaco-bridge'
import {
  cancelChangesFileFindSelection,
  tryOpenChangesFindFromSource,
} from '../utils/changes-file-find-bridge'

function isTypingContext(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement
    ? target
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  if (!element) return false
  if (element.isContentEditable) return true
  if (element.closest('input, textarea, select, [role="textbox"], [contenteditable="true"]')) return true
  if (element.closest('[class*="monaco-editor"]')) return true
  if (element.closest('[class*="terminalInner"]')) return true
  return false
}

export function useShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Shift+Enter handling when terminal is focused
      if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
        && (e.target as HTMLElement)?.closest?.('[class*="terminalInner"]')) {
        const s = useAppStore.getState()
        const tab = s.tabs.find((t) => t.id === s.activeTabId)
        // Skip when focused pane is a file editor — let Monaco handle Shift+Enter natively
        if (tab?.type === 'terminal' && isFocusedPaneTerminal(tab.splitRoot, tab.focusedPaneId)) {
          // Write kitty keyboard protocol so CLIs (e.g. Claude Code) can distinguish
          // Shift+Enter (new line) from Enter (submit).
          e.preventDefault()
          e.stopPropagation()
          const pty = getFocusedPtyId(tab.splitRoot, tab.focusedPaneId, tab.ptyId)
          if (pty) window.api.pty.write(pty, '\x1b[13;2u')
        }
        return
      }

      // Cmd+Left/Right/Backspace: macOS line-editing conventions.
      // Only Cmd (not Ctrl) — Ctrl+arrow is word movement handled by shells/TUIs.
      if (e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
        && (e.target as HTMLElement)?.closest?.('[class*="terminalInner"]')) {
        const s = useAppStore.getState()
        const tab = s.tabs.find((t) => t.id === s.activeTabId)
        if (tab?.type === 'terminal' && isFocusedPaneTerminal(tab.splitRoot, tab.focusedPaneId)) {
          const pty = getFocusedPtyId(tab.splitRoot, tab.focusedPaneId, tab.ptyId)
          if (pty && e.key === 'ArrowLeft') {
            e.preventDefault()
            e.stopPropagation()
            window.api.pty.write(pty, '\x01') // Ctrl+A — beginning of line
            return
          }
          if (pty && e.key === 'ArrowRight') {
            e.preventDefault()
            e.stopPropagation()
            window.api.pty.write(pty, '\x05') // Ctrl+E — end of line
            return
          }
          if (pty && e.key === 'Backspace') {
            e.preventDefault()
            e.stopPropagation()
            window.api.pty.write(pty, '\x15') // Ctrl+U — kill to beginning of line
            return
          }
        }
      }

      // ── Tab switching: Cmd+Left / Cmd+Right (non-terminal context) ──
      if (e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          e.stopPropagation()
          useAppStore.getState().prevTab()
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          e.stopPropagation()
          useAppStore.getState().nextTab()
          return
        }
      }

      // Ctrl+Tab — cycle focus between split panes
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        useAppStore.getState().cycleFocusedPane()
        return
      }

      const meta = e.metaKey || e.ctrlKey
      const shift = e.shiftKey
      const alt = e.altKey
      if (!meta) return

      const store = useAppStore.getState()

      // Stop event from reaching terminal (capture phase — must stopPropagation)
      function consume() {
        e.preventDefault()
        e.stopPropagation()
      }

      // ── Linear panel (full-screen): Issues / Projects / Tickets / Updates pill ──
      // ⌥⌘←/→, ⌘[/], ⌘1–4 — only while Linear is open (overrides same chords used for workspaces / editor tabs).
      if (store.linearPanelOpen) {
        const order = normalizeLinearWorkspaceTabOrder(store.settings.linearWorkspaceTabOrder)
        const cur = normalizeLinearWorkspaceView(store.settings.linearWorkspaceView)

        if (!shift && alt && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          consume()
          const next =
            e.key === 'ArrowRight'
              ? linearWorkspaceViewNext(cur, order)
              : linearWorkspaceViewPrev(cur, order)
          store.updateSettings({ linearWorkspaceView: next })
          return
        }

        if (!shift && !alt && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
          consume()
          const next =
            e.code === 'BracketRight'
              ? linearWorkspaceViewNext(cur, order)
              : linearWorkspaceViewPrev(cur, order)
          store.updateSettings({ linearWorkspaceView: next })
          return
        }

        if (!shift && !alt) {
          let n: number | undefined
          const fromCode = /^Digit([1-4])$/.exec(e.code) ?? /^Numpad([1-4])$/.exec(e.code)
          if (fromCode) n = Number(fromCode[1])
          else if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')
            n = Number(e.key)
          if (n !== undefined && n >= 1 && n <= 4) {
            const tab = order[n - 1]
            if (tab) {
              consume()
              store.updateSettings({ linearWorkspaceView: tab })
              return
            }
          }
        }
      }

      // ── Cmd+L: plan edit sidecar on plan surfaces; Add to Chat elsewhere ──
      if (!shift && !alt && e.code === 'KeyL') {
        const target = e.target as HTMLElement
        const activeEl = document.activeElement as HTMLElement | null
        if (target?.closest?.('[class*="terminalInner"]') || activeEl?.closest?.('[class*="terminalInner"]')) {
          return
        }

        const activeTab = store.tabs.find((tab) => tab.id === store.activeTabId)
        const inMonaco =
          target?.closest?.('[class*="monaco-editor"]') ?? activeEl?.closest?.('[class*="monaco-editor"]')
        const focusedMonacoPath = getFocusedMonacoEditor()?.getModel()?.uri.path

        if (inMonaco && focusedMonacoPath && isPlanSidecarPath(focusedMonacoPath)) {
          consume()
          void openPlanEditSidecar(focusedMonacoPath)
          return
        }

        if (inMonaco) {
          if (runMonacoAddToChatIfFocused()) {
            consume()
          }
          return
        }

        const preview =
          (target?.closest?.('[data-constellagent-md-preview]') as HTMLElement | null)
          ?? (activeEl?.closest?.('[data-constellagent-md-preview]') as HTMLElement | null)
          ?? findMarkdownPreviewRootForCurrentSelection()
        const previewFilePath = preview?.dataset.constellagentFilePath

        if (previewFilePath && isPlanSidecarPath(previewFilePath)) {
          consume()
          void openPlanEditSidecar(previewFilePath, { fallbackMode: 'header-only' })
          return
        }

        if (previewFilePath) {
          const text = window.getSelection()?.toString().trim() ?? ''
          if (!text) return
          consume()
          sendAddToChatText(previewFilePath, 'markdown', text)
          return
        }

        const activePlanFilePath =
          activeTab?.type === 'markdownPreview'
            ? activeTab.filePath
            : activeTab?.type === 'file'
              ? activeTab.filePath
              : undefined
        if (activePlanFilePath && isPlanSidecarPath(activePlanFilePath)) {
          consume()
          void openPlanEditSidecar(
            activePlanFilePath,
            activeTab?.type === 'markdownPreview' ? { fallbackMode: 'header-only' } : undefined,
          )
          return
        }
      }

      // ── Find in editor vs changed-files find vs quick open: Cmd+F ──
      if (!shift && !alt && e.code === 'KeyF') {
        if (store.changesFileFind) {
          cancelChangesFileFindSelection()
          consume()
          return
        }
        if (
          store.linearPanelOpen
          && (store.settings.linearWorkspaceView === 'issues'
            || store.settings.linearWorkspaceView === 'projects'
            || store.settings.linearWorkspaceView === 'tickets')
        ) {
          consume()
          store.openLinearQuickOpen()
          return
        }
        const activeTab = store.tabs.find((t) => t.id === store.activeTabId)
        // When the file tab has splits (e.g. file ⟷ terminal), require real Monaco focus so ⌘F from the terminal opens Quick Open.
        const allowUnfocusedMonacoFind =
          activeTab?.type === 'file' && !activeTab.splitRoot
        // Fallback when Monaco's per-editor addCommand didn't intercept
        // (widget focus or unfocused-allowance case). The fallback also routes
        // to QuickOpen with the active file pinned — we never open Monaco's
        // native inline find widget from this path.
        if (openQuickOpenFromFocusedEditor(allowUnfocusedMonacoFind)) {
          consume()
          return
        }
        if (activeTab?.type === 'diff' && tryOpenChangesFindFromSource('diff-tab')) {
          consume()
          return
        }
        const focusEl = document.activeElement as HTMLElement | null
        const changesSide = findSideForPanel(store.sidePanels, 'changes')
        const inChangesPanel =
          store.sidePanels[changesSide].open
          && store.sidePanels[changesSide].activePanel === 'changes'
          && Boolean(focusEl?.closest?.(`[data-panel-side="${changesSide}"]`))
        if (inChangesPanel && tryOpenChangesFindFromSource('changes-panel')) {
          consume()
          return
        }
        consume()
        store.toggleQuickOpen()
        return
      }

      // ── Workspace switching: Cmd+Shift+Up / Cmd+Shift+Down ──
      if (shift && !alt && e.key === 'ArrowUp') {
        consume()
        store.prevWorkspace()
        return
      }
      if (shift && !alt && e.key === 'ArrowDown') {
        consume()
        store.nextWorkspace()
        return
      }

      // Cmd+[ / Cmd+]: prev/next workspace within the active project only (Option+Up/Down still cycles all visible workspaces).
      if (!shift && !alt && e.code === 'BracketLeft') {
        consume()
        store.prevWorkspaceInActiveProject()
        return
      }
      if (!shift && !alt && e.code === 'BracketRight') {
        consume()
        store.nextWorkspaceInActiveProject()
        return
      }

      // ── Workspace switching: Cmd+Option+Up / Cmd+Option+Down ──
      if (!shift && alt && e.key === 'ArrowUp') {
        consume()
        store.prevWorkspace()
        return
      }
      if (!shift && alt && e.key === 'ArrowDown') {
        consume()
        store.nextWorkspace()
        return
      }

      // ── Tab switching: Cmd+Option+Left / Cmd+Option+Right ──
      if (!shift && alt && e.key === 'ArrowLeft') {
        consume()
        store.prevTab()
        return
      }
      if (!shift && alt && e.key === 'ArrowRight') {
        consume()
        store.nextTab()
        return
      }

      // ── Tab management ──
      if (!shift && !alt && e.key === 't') {
        consume()
        store.createTerminalForActiveWorkspace()
        return
      }
      if (shift && !alt && e.code === 'KeyN') {
        consume()
        store.createTerminalForActiveWorkspace()
        return
      }
      // Cmd+D — split terminal pane right
      if (!shift && !alt && e.code === 'KeyD') {
        consume()
        store.splitTerminalPane('horizontal')
        return
      }
      // Cmd+Shift+D — split terminal pane down
      if (shift && !alt && e.code === 'KeyD') {
        consume()
        store.splitTerminalPane('vertical')
        return
      }
      // Cmd+\ — open current file in split pane alongside terminal
      if (!shift && !alt && e.key === '\\') {
        consume()
        const activeTab = store.tabs.find((t) => t.id === store.activeTabId)
        if (activeTab?.type === 'file') {
          store.openFileInSplit(activeTab.filePath)
        }
        return
      }
      if (!shift && !alt && e.key === 'w') {
        consume()
        // If the active terminal tab has splits, close just the focused pane
        const wTab = store.tabs.find((t) => t.id === store.activeTabId)
        if (
          wTab
          && (wTab.type === 'terminal' || wTab.type === 'file')
          && wTab.splitRoot
          && wTab.focusedPaneId
        ) {
          store.closeSplitPane(wTab.focusedPaneId)
        } else {
          store.closeActiveTab()
        }
        return
      }
      if (shift && !alt && e.code === 'KeyW') {
        consume()
        store.closeAllWorkspaceTabs()
        return
      }
      if (shift && !alt && e.key === ']') {
        consume()
        store.nextTab()
        return
      }
      if (shift && !alt && e.key === '[') {
        consume()
        store.prevTab()
        return
      }

      // Cmd+1..9 — switch projects by visible sidebar order (1-based).
      // Intentionally not gated on isTypingContext: Monaco/xterm count as typing targets,
      // but these shortcuts should still work from editor and terminal.
      // Use e.key fallback: some hosts (Electron + xterm focus) omit or vary `code` for ⌘digit.
      if (!shift && !alt) {
        let n: number | undefined
        const fromCode = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code)
        if (fromCode) n = Number(fromCode[1])
        else if (e.key >= '1' && e.key <= '9') n = Number(e.key)
        if (n !== undefined) {
          consume()
          store.switchToProjectByIndex(n - 1)
          return
        }
      }

      // ── Panels ──
      // Cmd+B — toggle the physical left sidebar host
      if (!shift && !alt && e.key === 'b') {
        consume()
        store.toggleSidebar()
        return
      }
      // Cmd+Option+B — toggle the physical right sidebar host (use e.code since Option changes e.key on macOS)
      if (!shift && alt && e.code === 'KeyB') {
        consume()
        store.toggleRightPanel()
        return
      }
      // Cmd+Shift+E — files panel (routes to the side that owns Files)
      if (shift && !alt && e.code === 'KeyE') {
        consume()
        store.activatePanel('files')
        return
      }
      // Cmd+Shift+G — changes panel (routes to the side that owns Changes)
      if (shift && !alt && e.code === 'KeyG') {
        consume()
        store.activatePanel('changes')
        return
      }
      // Cmd+Option+G — git panel (routes to the side that owns Git)
      if (!shift && alt && e.code === 'KeyG') {
        consume()
        store.activatePanel('graph')
        return
      }

      // ── Focus ──
      // Cmd+J — focus terminal (or create one)
      if (!shift && !alt && e.key === 'j') {
        consume()
        store.focusOrCreateTerminal()
        return
      }

      // ── Font size: Cmd+= / Cmd+- / Cmd+0 ──
      if (!shift && !alt && (e.key === '=' || e.key === '-' || e.key === '0')) {
        consume()
        const tab = store.tabs.find((t) => t.id === store.activeTabId)
        const isTerminal = tab?.type === 'terminal'
        const key = isTerminal ? 'terminalFontSize' : 'editorFontSize'
        if (e.key === '0') {
          store.updateSettings({ terminalFontSize: 14, editorFontSize: 13 })
        } else {
          const current = store.settings[key]
          const next = Math.max(8, Math.min(32, current + (e.key === '=' ? 1 : -1)))
          store.updateSettings({ [key]: next })
        }
        return
      }

      // Cmd+Shift+T — toggle graphite stack expanded/collapsed
      if (shift && !alt && e.code === 'KeyT') {
        consume()
        store.toggleGraphiteStackExpanded()
        return
      }

      // Cmd+Shift+M — open plan palette (search + filter by agent)
      if (shift && !alt && e.code === 'KeyM') {
        consume()
        store.togglePlanPalette()
        return
      }

      // Cmd+Shift+R — toggle hunk review panel
      if (shift && !alt && e.code === 'KeyR') {
        consume()
        void store.toggleHunkReview()
        return
      }

      // ── Add to Chat: Cmd+L ──
      if (!shift && !alt && e.key === 'l') {
        consume()
        sendActiveSelectionToAgent()
        return
      }

      // ── Settings ──
      // Cmd+, — toggle settings
      if (!shift && !alt && e.key === ',') {
        consume()
        store.toggleSettings()
        return
      }

      // ── Open in editor: Cmd+Shift+O ──
      if (shift && !alt && e.code === 'KeyO') {
        consume()
        const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId)
        if (ws) {
          const { cli, name, extraArgs, openMode } = resolveEditor(store.settings)
          window.api.app.openInEditor(ws.worktreePath, cli, extraArgs, openMode).then((result) => {
            if (!result.success) {
              store.addToast({
                id: `editor-err-${Date.now()}`,
                message: result.error || `Failed to open ${name}`,
                type: 'error',
              })
            }
          })
        }
        return
      }

      // ── Delete file: Cmd+Backspace ──
      // Only when a file tab is active (not terminal/diff) and target is not a text input
      if (!shift && !alt && e.key === 'Backspace') {
        const target = e.target as HTMLElement
        // Don't intercept when focused inside Monaco editor or terminal
        if (target?.closest?.('[class*="monaco-editor"]') || target?.closest?.('[class*="terminalInner"]')) {
          return
        }
        const tab = store.tabs.find((t) => t.id === store.activeTabId)
        if (tab?.type === 'file') {
          consume()
          const fileName = tab.filePath.split('/').pop() || tab.filePath
          store.showConfirmDialog({
            title: 'Delete File',
            message: `Permanently delete "${fileName}"? This cannot be undone.`,
            confirmLabel: 'Delete',
            destructive: true,
            tip: 'Tip: Hold \u21e7 Shift while deleting to skip this dialog',
            onConfirm: () => {
              store.dismissConfirmDialog()
              window.api.fs.deleteFile(tab.filePath).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : 'Failed to delete'
                store.addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
              })
            },
          })
        }
        return
      }

      // ── T3 Code: Cmd+Shift+` (backtick) — avoids macOS ⌘⇧3 / ⌘⇧4 screenshots ──
      if (shift && !alt && e.code === 'Backquote') {
        consume()
        if (store.activeWorkspaceId) {
          store.openT3CodeTab(store.activeWorkspaceId)
        }
        return
      }

      // ── Workspace creation ──
      // Cmd+N — new workspace dialog
      if (!shift && !alt && e.key === 'n') {
        consume()
        const project = store.activeProject()
        if (project) {
          store.openWorkspaceDialog(project.id)
        } else if (store.projects.length > 0) {
          store.openWorkspaceDialog(store.projects[0].id)
        }
        return
      }
    }

    // Capture phase: runs before terminal handlers on the focused textarea.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  // Webview guest tab-switch: main process forwards ⌘⌥←/→ from guest WebContents.
  useEffect(() => {
    const unsubPrev = window.api.webview.onTabPrev(() => useAppStore.getState().prevTab())
    const unsubNext = window.api.webview.onTabNext(() => useAppStore.getState().nextTab())
    return () => { unsubPrev(); unsubNext() }
  }, [])

  // Image paste: terminal textareas ignore clipboard images, so intercept and save to temp file.
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement
      if (!target?.closest?.('[class*="terminalInner"]')) return
      if (!e.clipboardData) return

      const hasImage = Array.from(e.clipboardData.items).some(
        (item) => item.type.startsWith('image/')
      )
      if (!hasImage) return

      e.preventDefault()
      e.stopPropagation()

      const filePath = await window.api.clipboard.saveImage()
      if (!filePath) return

      const s = useAppStore.getState()
      const pty = resolveAgentPtyForContextInjection({
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        activeWorkspaceId: s.activeWorkspaceId,
      })
      if (pty) window.api.pty.write(pty, wrapBracketedPaste(filePath))
    }

    document.addEventListener('paste', handlePaste, true)
    return () => document.removeEventListener('paste', handlePaste, true)
  }, [])
}
