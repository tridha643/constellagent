import { useEffect, useState, useCallback, useRef, useImperativeHandle, forwardRef, useMemo, type ChangeEvent } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '../../store/app-store'
import { useGitGutter } from '../../hooks/useGitGutter'
import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer'
import { AddToChatMarkdownSurface } from '../AddToChat/AddToChatMarkdownSurface'
import { sendAddToChatText, isPlanSidecarPath, openPlanEditSidecar } from '../../utils/add-to-chat'
import { isAgentPlanPath } from '../../../shared/agent-plan-path'
import { stripYamlFrontmatterForPreview } from '../../../shared/plan-markdown-preview'
import { PlanAgentToolbar } from '../PlanAgentToolbar/PlanAgentToolbar'
import {
  setMonacoAddToChatHandler,
  clearMonacoAddToChatHandler,
  registerMonacoFileEditorForShortcuts,
} from '../../utils/add-to-chat-monaco-bridge'
import { ensureAppearanceMonacoThemes, getAppearanceMonacoThemeName } from '../../theme/appearance'
import styles from './Editor.module.css'

import {
  EDITOR_LANGUAGE_OVERRIDE_OPTIONS,
  getEditorLanguageOverrideKey,
  getEffectiveLanguage,
  getEffectiveModelPath,
  normalizeEditorLanguageOverride,
} from '../../utils/language-map'
import { usePrefersReducedMotion } from '../../hooks/use-prefers-reduced-motion'
import {
  clearLspDiagnosticsForUri,
  getLspServerKeyForPath,
  getLspTextDocumentLanguageId,
  getOrCreateClient,
  notifyDidChange,
  notifyDidClose,
  notifyDidOpen,
  toFileUri,
} from '../../services/lsp-client-manager'
import { markPaint, measureAsync } from '../../utils/perf'
import { DEFAULT_SETTINGS } from '../../store/types'
import {
  applyMonacoTypeScriptCompilerDefaults,
  applyMonacoTypeScriptDiagnostics,
} from '../../utils/monaco-typescript-diagnostics'
import { ensureMonacoPrismaLanguage } from '../../utils/monaco-prisma-language'

// Monaco themes + compiler defaults once; diagnostics follow Settings (see FileEditor effect).
let monacoAppearanceAndCompilerReady = false
const TS_JS_MONACO_LANGUAGES = new Set([
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
])

loader.init().then((monaco) => {
  ;(window as unknown as { __monaco?: typeof monaco }).__monaco = monaco
  if (!monacoAppearanceAndCompilerReady) {
    monacoAppearanceAndCompilerReady = true
    ensureAppearanceMonacoThemes(monaco.editor)
    ensureMonacoPrismaLanguage(monaco)
    applyMonacoTypeScriptCompilerDefaults(monaco)
  }
  applyMonacoTypeScriptDiagnostics(monaco, DEFAULT_SETTINGS.editorMonacoSemanticDiagnostics)
})

interface Props {
  tabId: string
  filePath: string
  active: boolean
  worktreePath?: string
  /** Browser tab id when `tabId` is a split pane id (defaults to `tabId`). */
  containingTabId?: string
}

export interface FileEditorHandle {
  focus(): void
}

export const FileEditor = forwardRef<FileEditorHandle, Props>(function FileEditor({ tabId, filePath, active, worktreePath, containingTabId }, ref) {
  const hostTabId = containingTabId ?? tabId
  const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.mdx')
  /** Prefer rendered view for agent-written plans when opening a markdown file tab. */
  const [previewMode, setPreviewMode] = useState(() =>
    filePath.endsWith('.md') || filePath.endsWith('.mdx'),
  )
  const [content, setContent] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const findShortcutDisposeRef = useRef<(() => void) | null>(null)
  const currentContentRef = useRef<string>('')
  const [userHome, setUserHome] = useState<string | undefined>(undefined)
  const setTabUnsaved = useAppStore((s) => s.setTabUnsaved)
  const setTabDeleted = useAppStore((s) => s.setTabDeleted)
  const notifyTabSaved = useAppStore((s) => s.notifyTabSaved)
  const addToast = useAppStore((s) => s.addToast)
  const setActiveMonacoEditor = useAppStore((s) => s.setActiveMonacoEditor)
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const editorFontSize = useAppStore((s) => s.settings.editorFontSize)
  const autoSaveOnBlur = useAppStore((s) => s.settings.autoSaveOnBlur)
  const editorMonacoSemanticDiagnostics = useAppStore((s) => s.settings.editorMonacoSemanticDiagnostics)
  const editorLanguageOverrides = useAppStore((s) => s.settings.editorLanguageOverrides)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const prefersReducedMotion = usePrefersReducedMotion()
  const languageOverrideKey = useMemo(
    () => getEditorLanguageOverrideKey(worktreePath, filePath),
    [worktreePath, filePath],
  )
  const languageOverride = editorLanguageOverrides[languageOverrideKey] ?? null
  const effectiveLanguage = useMemo(
    () => getEffectiveLanguage(filePath, languageOverride),
    [filePath, languageOverride],
  )
  const modelPath = useMemo(
    () => getEffectiveModelPath(filePath, effectiveLanguage, languageOverride),
    [effectiveLanguage, filePath, languageOverride],
  )
  const fileUri = useMemo(() => toFileUri(modelPath), [modelPath])
  const effectiveLspServerKey = useMemo(
    () => getLspServerKeyForPath(filePath, effectiveLanguage),
    [filePath, effectiveLanguage],
  )
  const effectiveLspDocumentLanguage = useMemo(
    () => getLspTextDocumentLanguageId(filePath, effectiveLanguage),
    [filePath, effectiveLanguage],
  )
  const shouldEnableMonacoSemanticDiagnostics = useMemo(() => {
    if (!editorMonacoSemanticDiagnostics) return false
    // Monaco's in-browser TS worker has no project graph, so workspace imports
    // produce false-positive "cannot find module" errors. Use syntax-only Monaco
    // for repo files and let the LSP bridge provide project-aware diagnostics.
    if (worktreePath && TS_JS_MONACO_LANGUAGES.has(effectiveLanguage)) return false
    return true
  }, [effectiveLanguage, editorMonacoSemanticDiagnostics, worktreePath])
  const lspSessionRef = useRef<{
    serverKey: string
    workspace: string
    uri: string
    documentLanguage: string
  } | null>(null)
  const lspDidChangeTimerRef = useRef<number | null>(null)
  const diskReadRequestRef = useRef(0)
  const editorOpenStartedAtRef = useRef(0)

  useEffect(() => {
    void window.api.app.getHomeDir().then(setUserHome).catch(() => {})
  }, [])

  const isPlan = useMemo(
    () => isMarkdown && isAgentPlanPath(worktreePath ?? '', filePath, userHome),
    [isMarkdown, worktreePath, filePath, userHome],
  )
  const previewRenderedMarkdown = useMemo(() => {
    if (!isMarkdown || content === null) return ''
    return isPlan ? stripYamlFrontmatterForPreview(content) : content
  }, [isMarkdown, content, isPlan])
  const runAddToChatRef = useRef<() => void>(() => {})

  const clearPendingLspChange = useCallback(() => {
    if (lspDidChangeTimerRef.current !== null) {
      window.clearTimeout(lspDidChangeTimerRef.current)
      lspDidChangeTimerRef.current = null
    }
  }, [])

  const readFileLatest = useCallback(async (reason: 'initial' | 'git-change' | 'dir-change') => {
    const requestId = ++diskReadRequestRef.current
    const text = await measureAsync('editor:read-file', () => window.api.fs.readFile(filePath), {
      filePath,
      reason,
      worktreePath: worktreePath ?? null,
    })
    if (requestId !== diskReadRequestRef.current) return { stale: true, text: null as string | null }
    return { stale: false, text }
  }, [filePath, worktreePath])

  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      fontFamily: "'SF Mono', Menlo, 'Cascadia Code', monospace",
      fontSize: editorFontSize,
      minimap: { enabled: false },
      scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
      padding: { top: 8, bottom: 8 },
      renderLineHighlight: 'line',
      cursorBlinking: prefersReducedMotion ? 'solid' : 'smooth',
      smoothScrolling: !prefersReducedMotion,
      tabSize: 2,
      wordWrap: 'off',
      automaticLayout: true,
    }),
    [editorFontSize, prefersReducedMotion],
  )

  const closeLspSession = useCallback((session = lspSessionRef.current) => {
    clearPendingLspChange()
    if (!session) return
    notifyDidClose(session.serverKey, session.workspace, session.uri)
    lspSessionRef.current = null
  }, [clearPendingLspChange])

  useEffect(() => {
    let cancelled = false
    void loader.init().then((monaco) => {
      if (!cancelled) {
        applyMonacoTypeScriptDiagnostics(monaco, shouldEnableMonacoSemanticDiagnostics)
      }
    })
    return () => {
      cancelled = true
    }
  }, [shouldEnableMonacoSemanticDiagnostics])

  // Git gutter decorations (no-op when worktreePath is undefined or editor not mounted)
  useGitGutter(editorInstance, filePath, worktreePath)

  useImperativeHandle(ref, () => ({
    focus() {
      editorRef.current?.focus()
    },
  }), [])

  // Load file content
  useEffect(() => {
    let cancelled = false
    editorOpenStartedAtRef.current = performance.now()
    void readFileLatest('initial').then(({ stale, text }) => {
      if (stale || cancelled) return
      markPaint('file-editor-ready', editorOpenStartedAtRef.current, {
        filePath,
        worktreePath: worktreePath ?? null,
      })
      if (cancelled) return
      if (text === null) {
        // File doesn't exist (e.g. restored tab for a deleted file)
        setTabDeleted(tabId, true)
        setContent('')
        return
      }
      setContent(text)
      currentContentRef.current = text
      setUnsaved(false)
      setTabUnsaved(tabId, false)
    })
    return () => {
      cancelled = true
      diskReadRequestRef.current += 1
    }
  }, [filePath, tabId, setTabUnsaved, setTabDeleted, readFileLatest, worktreePath])

  // Reload file content when in-app git operations (discard, commit) affect this file
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!worktreePath || detail?.worktreePath !== worktreePath) return
      const relPath = filePath.startsWith(worktreePath)
        ? filePath.slice(worktreePath.length).replace(/^\//, '')
        : null
      if (!relPath || !detail.paths?.includes(relPath)) return

      void readFileLatest('git-change').then(({ stale, text }) => {
        if (stale) return
        if (text === null) {
          // File deleted (untracked discard) — mark tab as deleted
          setTabDeleted(tabId, true)
          return
        }
        setContent(text)
        currentContentRef.current = text
        setUnsaved(false)
        setTabUnsaved(tabId, false)
        setTabDeleted(tabId, false)
      })
    }
    window.addEventListener('git:files-changed', handler)
    return () => window.removeEventListener('git:files-changed', handler)
  }, [filePath, worktreePath, tabId, setTabUnsaved, setTabDeleted, readFileLatest])

  // Watch for external file changes (terminal git operations, branch switches)
  useEffect(() => {
    if (!worktreePath) return

    const cleanup = window.api.fs.onDirChanged((changedDir) => {
      if (changedDir !== worktreePath) return

      void readFileLatest('dir-change').then(({ stale, text: diskContent }) => {
        if (stale) return
        if (diskContent === null) {
          if (!unsaved) {
            setTabDeleted(tabId, true)
          }
          return
        }
        if (diskContent === currentContentRef.current) return
        if (unsaved) {
          addToast({
            id: `file-changed-${tabId}`,
            message: `${filePath.split('/').pop()} changed on disk`,
            type: 'info',
          })
        } else {
          setContent(diskContent)
          currentContentRef.current = diskContent
          setTabDeleted(tabId, false)
        }
      })
    })

    return cleanup
  }, [filePath, worktreePath, tabId, unsaved, setTabUnsaved, setTabDeleted, addToast, readFileLatest])

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      currentContentRef.current = value
      setContent(value)
      const session = lspSessionRef.current
      if (session) {
        clearPendingLspChange()
        lspDidChangeTimerRef.current = window.setTimeout(() => {
          notifyDidChange(session.serverKey, session.workspace, session.uri, currentContentRef.current)
          lspDidChangeTimerRef.current = null
        }, 120)
      }
      if (!unsaved) {
        setUnsaved(true)
        setTabUnsaved(tabId, true)
      }
    }
  }, [clearPendingLspChange, unsaved, tabId, setTabUnsaved])

  const handleSave = useCallback(async () => {
    await window.api.fs.writeFile(filePath, currentContentRef.current)
    setUnsaved(false)
    setTabUnsaved(tabId, false)
    notifyTabSaved(tabId)
  }, [filePath, tabId, setTabUnsaved, notifyTabSaved])

  // Auto-save on blur when setting is enabled
  const prevActiveRef = useRef(active)
  useEffect(() => {
    if (prevActiveRef.current && !active && unsaved && autoSaveOnBlur) {
      void handleSave()
    }
    prevActiveRef.current = active
  }, [active, unsaved, autoSaveOnBlur, handleSave])

  useEffect(() => {
    const currentSession = lspSessionRef.current
    const contentReady = content !== null
    if (!contentReady || !worktreePath || !effectiveLspServerKey) {
      if (currentSession) closeLspSession(currentSession)
      else void clearLspDiagnosticsForUri(fileUri)
      return
    }

    const needsReopen =
      !currentSession ||
      currentSession.serverKey !== effectiveLspServerKey ||
      currentSession.workspace !== worktreePath ||
      currentSession.uri !== fileUri ||
      currentSession.documentLanguage !== effectiveLspDocumentLanguage

    if (!needsReopen) return

    if (currentSession) closeLspSession(currentSession)

    let cancelled = false
    const lspStartedAt = performance.now()
    measureAsync('editor:lsp-attach', () => getOrCreateClient(effectiveLspServerKey, worktreePath), {
      filePath,
      worktreePath,
      language: effectiveLspServerKey,
    }).then((client) => {
      if (cancelled || !client) return
      const nextSession = {
        serverKey: effectiveLspServerKey,
        workspace: worktreePath,
        uri: fileUri,
        documentLanguage: effectiveLspDocumentLanguage,
      }
      lspSessionRef.current = nextSession
      notifyDidOpen(
        nextSession.serverKey,
        nextSession.workspace,
        nextSession.uri,
        currentContentRef.current,
        nextSession.documentLanguage,
      )
      markPaint('file-editor-lsp-ready', lspStartedAt, {
        filePath,
        worktreePath,
        language: effectiveLspServerKey,
      })
    }).catch(() => {})

    return () => {
      cancelled = true
      const liveSession = lspSessionRef.current
      if (
        liveSession &&
        liveSession.serverKey === effectiveLspServerKey &&
        liveSession.workspace === worktreePath &&
        liveSession.uri === fileUri &&
        liveSession.documentLanguage === effectiveLspDocumentLanguage
      ) {
        closeLspSession(liveSession)
      }
    }
  }, [
    closeLspSession,
    content,
    effectiveLspDocumentLanguage,
    effectiveLspServerKey,
    fileUri,
    worktreePath,
  ])

  useEffect(() => {
    const session = lspSessionRef.current
    if (!session || content === null || unsaved || currentContentRef.current !== content) return
    notifyDidChange(session.serverKey, session.workspace, session.uri, content)
  }, [content, fileUri, unsaved])

  useEffect(() => {
    const ed = editorInstance
    if (!ed) return
    const model = ed.getModel()
    if (!model || model.getLanguageId() === effectiveLanguage) return
    void loader.init().then((monaco) => {
      const liveModel = ed.getModel()
      if (liveModel && liveModel.getLanguageId() !== effectiveLanguage) {
        monaco.editor.setModelLanguage(liveModel, effectiveLanguage)
      }
    })
  }, [editorInstance, effectiveLanguage])

  useEffect(() => () => {
    closeLspSession()
    findShortcutDisposeRef.current?.()
    findShortcutDisposeRef.current = null
  }, [closeLspSession])

  const handleLanguageOverrideChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value
    const nextOverrides = { ...editorLanguageOverrides }
    const normalized = normalizeEditorLanguageOverride(nextValue)
    if (normalized) nextOverrides[languageOverrideKey] = normalized
    else delete nextOverrides[languageOverrideKey]
    updateSettings({ editorLanguageOverrides: nextOverrides })
  }, [languageOverrideKey, editorLanguageOverrides, updateSettings])

  // Cmd+S + Cmd+L fallback (2048 = CtrlCmd). Primary ⌘L path: useShortcuts capture + monaco bridge.
  const handleEditorMount = useCallback((ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed
    findShortcutDisposeRef.current?.()
    findShortcutDisposeRef.current = registerMonacoFileEditorForShortcuts(ed)
    setEditorInstance(ed)
    setActiveMonacoEditor(ed)
    ed.addCommand(2048 | 49, () => handleSave())
    ed.addCommand(2048 | 42, () => runAddToChatRef.current())
  }, [handleSave, setActiveMonacoEditor])

  useEffect(() => {
    const ed = editorInstance
    if (!ed) return

    runAddToChatRef.current = () => {
      const selection = ed.getSelection()
      const model = ed.getModel()
      if (!selection || !model) return

      if (isPlanSidecarPath(filePath)) {
        const selectedText = selection.isEmpty() ? '' : model.getValueInRange(selection)
        void openPlanEditSidecar(filePath, {
          text: selectedText || undefined,
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber,
          fullText: model.getValue(),
        })
        return
      }

      if (selection.isEmpty()) {
        addToast({
          id: crypto.randomUUID(),
          message: 'Select text to add to the terminal',
          type: 'info',
        })
        return
      }
      const text = model.getValueInRange(selection)
      sendAddToChatText(filePath, effectiveLanguage, text)
    }

    const subFocus = ed.onDidFocusEditorWidget(() => {
      setActiveMonacoEditor(ed)
      setMonacoAddToChatHandler(ed, () => runAddToChatRef.current())
    })
    const subBlur = ed.onDidBlurEditorWidget(() => {
      setActiveMonacoEditor(null)
      clearMonacoAddToChatHandler(ed)
    })

    if (ed.hasTextFocus()) {
      setActiveMonacoEditor(ed)
      setMonacoAddToChatHandler(ed, () => runAddToChatRef.current())
    }

    return () => {
      subFocus.dispose()
      subBlur.dispose()
      setActiveMonacoEditor(null)
      clearMonacoAddToChatHandler(ed)
    }
  }, [editorInstance, effectiveLanguage, filePath, addToast, setActiveMonacoEditor])

  if (content === null) {
    return (
      <div className={styles.editorContainer}>
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading file"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            height: '100%',
            padding: '0 24px',
          }}
        >
          <div className="shimmer-block" style={{ width: 'min(360px, 70%)', height: 14 }} />
          <div className="shimmer-block" style={{ width: 'min(280px, 55%)', height: 14 }} />
          <div className="shimmer-block" style={{ width: 'min(320px, 62%)', height: 14 }} />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.editorContainer}>
      <div className={styles.diffToolbar}>
        <span className={styles.diffLabel}>{filePath.split('/').pop()}</span>
        <div className={styles.markdownToolbarEnd}>
          {isPlan && worktreePath && (
            <PlanAgentToolbar
              filePath={filePath}
              worktreePath={worktreePath}
              hostTabId={hostTabId}
            />
          )}
          <label className={styles.languagePicker}>
            <span className={styles.languagePickerLabel}>Language</span>
            <select
              data-testid="editor-language-select"
              className={styles.languageSelect}
              value={languageOverride ?? ''}
              onChange={handleLanguageOverrideChange}
            >
              {EDITOR_LANGUAGE_OVERRIDE_OPTIONS.map((option) => (
                <option key={option.value || 'auto'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {isMarkdown && (
            <div className={styles.diffToggle}>
              <button
                type="button"
                className={`${styles.diffToggleOption} ${!previewMode ? styles.active : ''}`}
                onClick={() => setPreviewMode(false)}
              >
                Source
              </button>
              <button
                type="button"
                className={`${styles.diffToggleOption} ${previewMode ? styles.active : ''}`}
                onClick={() => setPreviewMode(true)}
              >
                Preview
              </button>
            </div>
          )}
        </div>
      </div>
      {previewMode && isMarkdown ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <AddToChatMarkdownSurface filePath={filePath}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <MarkdownRenderer>{previewRenderedMarkdown}</MarkdownRenderer>
            </div>
          </AddToChatMarkdownSurface>
        </div>
      ) : (
        <Editor
          height="100%"
          language={effectiveLanguage}
          path={modelPath}
          value={content}
          theme={getAppearanceMonacoThemeName(appearanceThemeId)}
          onChange={handleChange}
          onMount={handleEditorMount}
          options={editorOptions}
        />
      )}
    </div>
  )
})
