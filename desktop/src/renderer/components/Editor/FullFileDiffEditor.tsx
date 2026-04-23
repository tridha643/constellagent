import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { loader } from '@monaco-editor/react'
import type { editor, IDisposable } from 'monaco-editor'
import { useAppStore } from '../../store/app-store'
import { ensureAppearanceMonacoThemes, getAppearanceMonacoThemeName } from '../../theme/appearance'
import { getLanguage } from '../../utils/language-map'
import { usePrefersReducedMotion } from '../../hooks/use-prefers-reduced-motion'
import type { WorkingTreeFileStatus } from '../../types/working-tree-diff'
import { sendAddToChatText } from '../../utils/add-to-chat'
import {
  setMonacoAddToChatHandler,
  clearMonacoAddToChatHandler,
} from '../../utils/add-to-chat-monaco-bridge'
import styles from './Editor.module.css'

// KeyMod.CtrlCmd | KeyCode.KeyL — hard-coded to avoid importing Monaco's
// runtime namespace (same pattern as add-to-chat-monaco-bridge.ts).
const CMD_L_BINDING = 2048 | 42

/**
 * Wire Cmd+L (Add to Chat) on a read-only editor inside the diff view:
 *   - `ed.addCommand(Cmd+L, …)` captures it when Monaco has text focus.
 *   - `setMonacoAddToChatHandler` on focus / clear on blur routes the global
 *     capture-phase ⌘L in `useShortcuts` to this editor when widgets (not the
 *     text area) hold focus. Mirrors the FileEditor wiring so the shortcut
 *     behaves identically whether the user is in a file tab or a diff tab.
 * Sends the current selection; falls back to the full buffer if nothing is
 * selected — the user explicitly opened this diff for this file, so shipping
 * the whole side is the sensible default.
 */
function wireAddToChatForDiffEditor(
  ed: editor.IStandaloneCodeEditor,
  filePath: string,
  language: string,
): IDisposable[] {
  const run = () => {
    const model = ed.getModel()
    if (!model) return
    const selection = ed.getSelection()
    const text = selection && !selection.isEmpty()
      ? model.getValueInRange(selection)
      : model.getValue()
    if (!text || !text.trim()) return
    sendAddToChatText(filePath, language, text)
  }

  // Monaco's `addCommand` has no dispose hook; the binding lives with the
  // editor instance and is released when the editor is disposed by its
  // surrounding effect. That's intentional — we don't want to leak bindings
  // across remounts, which is why the surrounding effect re-creates editors
  // fresh on layout / content changes.
  ed.addCommand(CMD_L_BINDING, run)

  const focusSub = ed.onDidFocusEditorWidget(() => {
    setMonacoAddToChatHandler(ed, run)
  })
  const blurSub = ed.onDidBlurEditorWidget(() => {
    clearMonacoAddToChatHandler(ed)
  })
  if (ed.hasTextFocus()) {
    setMonacoAddToChatHandler(ed, run)
  }

  return [
    focusSub,
    blurSub,
    { dispose: () => clearMonacoAddToChatHandler(ed) },
  ]
}

interface Props {
  filePath: string
  worktreePath: string
  status?: WorkingTreeFileStatus['status']
  originalRef?: string
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

function statusLabel(status?: WorkingTreeFileStatus['status']): string {
  switch (status) {
    case 'added': return 'Added'
    case 'deleted': return 'Deleted'
    case 'modified': return 'Modified'
    case 'renamed': return 'Renamed'
    case 'untracked': return 'Untracked'
    default: return ''
  }
}

function looksBinary(content: string): boolean {
  const sample = content.length > 8192 ? content.slice(0, 8192) : content
  return sample.indexOf('\u0000') !== -1
}

const MAX_DIFF_FILE_BYTES = 2_000_000

type MonacoApi = Awaited<ReturnType<typeof loader.init>>

function joinWorktreeFile(worktreePath: string, relativePath: string): string {
  const fp = relativePath.replace(/\\/g, '/')
  if (fp.startsWith('/') && !fp.match(/^\/[A-Za-z]:\//)) {
    return relativePath
  }
  if (/^[A-Za-z]:\//.test(fp) || relativePath.startsWith('\\\\')) {
    return relativePath
  }
  const segs = fp.replace(/^\//, '').split('/').filter(Boolean)
  const base = worktreePath.replace(/[/\\]+$/, '')
  const isWin = /^[A-Za-z]:[\\/]/.test(base) || base.startsWith('\\\\')
  if (isWin) {
    return segs.length ? [base, ...segs].join('\\') : base
  }
  return segs.length ? [base, ...segs].join('/') : base
}

function buildReadOnlyEditorOptions(
  fontSize: number,
  prefersReducedMotion: boolean,
): editor.IStandaloneEditorConstructionOptions {
  return {
    readOnly: true,
    minimap: { enabled: false },
    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
    padding: { top: 8, bottom: 8 },
    renderLineHighlight: 'line',
    cursorBlinking: prefersReducedMotion ? 'solid' : 'smooth',
    smoothScrolling: !prefersReducedMotion,
    automaticLayout: true,
    glyphMargin: false,
    lineNumbersMinChars: 2,
    lineDecorationsWidth: 4,
    fixedOverflowWidgets: true,
    fontFamily: "'SF Mono', Menlo, 'Cascadia Code', monospace",
    fontSize,
    wordWrap: 'off',
  }
}

function buildPureChangeDecorations(
  monaco: MonacoApi,
  model: editor.ITextModel,
  kind: 'added' | 'deleted',
): editor.IModelDeltaDecoration[] {
  const lineCount = model.getLineCount()
  const className = kind === 'added' ? 'cga-full-file-added-line' : 'cga-full-file-deleted-line'
  const linesDecorationsClassName = kind === 'added'
    ? 'cga-full-file-added-gutter'
    : 'cga-full-file-deleted-gutter'
  const decorations: editor.IModelDeltaDecoration[] = []
  for (let line = 1; line <= lineCount; line += 1) {
    decorations.push({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className,
        linesDecorationsClassName,
      },
    })
  }
  return decorations
}

type EditorBundle = {
  editors: editor.IStandaloneCodeEditor[]
  models: editor.ITextModel[]
  collections: editor.IEditorDecorationsCollection[]
  disposables: IDisposable[]
}

function disposeEditorBundle(bundle: EditorBundle | null) {
  if (!bundle) return
  // Subscriptions first — they reference editors/models we're about to dispose.
  for (const d of bundle.disposables) {
    try { d.dispose() } catch { /* empty */ }
  }
  for (const collection of bundle.collections) {
    try {
      collection.clear()
    } catch { /* empty */ }
  }
  for (const editorInstance of bundle.editors) {
    try {
      editorInstance.dispose()
    } catch { /* empty */ }
  }
  for (const model of bundle.models) {
    try {
      model.dispose()
    } catch { /* empty */ }
  }
}

function PureFileChangeSurface({
  kind,
  content,
  inline,
  language,
  appearanceThemeId,
  editorFontSize,
  prefersReducedMotion,
  filePath,
}: {
  kind: 'added' | 'deleted'
  content: string
  inline: boolean
  language: string
  appearanceThemeId: string
  editorFontSize: number
  prefersReducedMotion: boolean
  filePath: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)
  const splitWrapRef = useRef<HTMLDivElement | null>(null)
  const bundleRef = useRef<EditorBundle | null>(null)
  const monacoRef = useRef<MonacoApi | null>(null)
  const instanceId = useId().replace(/:/g, '')

  // Split ratio: [0.15, 0.85] of container width for the left pane.
  // Kept in refs for pointer-move drag (no re-render per frame); committed
  // to state only on pointerup for a clean handoff to the next render.
  const ratioRef = useRef(0.5)
  const [ratio, setRatio] = useState(0.5)
  const [isResizing, setIsResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startRatio: number; width: number } | null>(null)

  const layoutEditors = useCallback(() => {
    const bundle = bundleRef.current
    if (!bundle) return
    for (const ed of bundle.editors) {
      try { ed.layout() } catch { /* empty */ }
    }
  }, [])

  const applyRatio = useCallback((r: number) => {
    const clamped = Math.max(0.15, Math.min(0.85, r))
    ratioRef.current = clamped
    if (leftRef.current) {
      leftRef.current.style.flexBasis = `${clamped * 100}%`
    }
    layoutEditors()
  }, [layoutEditors])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const wrap = splitWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    dragRef.current = { startX: event.clientX, startRatio: ratioRef.current, width: rect.width }
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    if (!isResizing) return
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.width <= 0) return
      const dx = e.clientX - drag.startX
      applyRatio(drag.startRatio + dx / drag.width)
    }
    const onUp = () => {
      setRatio(ratioRef.current)
      setIsResizing(false)
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [isResizing, applyRatio])

  useEffect(() => {
    let live = true

    const run = async () => {
      const monaco = monacoRef.current ?? await loader.init()
      if (!live) return
      monacoRef.current = monaco
      ensureAppearanceMonacoThemes(monaco.editor)
      monaco.editor.setTheme(getAppearanceMonacoThemeName(appearanceThemeId as never))

      disposeEditorBundle(bundleRef.current)

      const options = buildReadOnlyEditorOptions(editorFontSize, prefersReducedMotion)
      const next: EditorBundle = {
        editors: [],
        models: [],
        collections: [],
        disposables: [],
      }

      if (inline) {
        if (!hostRef.current) return
        const uri = monaco.Uri.parse(
          `inmemory://cga-pure/${kind}/${instanceId}/${encodeURIComponent(filePath.replace(/^\//, ''))}`,
        )
        const model = monaco.editor.createModel(content, language, uri)
        const editorInstance = monaco.editor.create(hostRef.current, { model, ...options })
        const collection = editorInstance.createDecorationsCollection(
          buildPureChangeDecorations(monaco, model, kind),
        )
        next.editors.push(editorInstance)
        next.models.push(model)
        next.collections.push(collection)
        next.disposables.push(...wireAddToChatForDiffEditor(editorInstance, filePath, language))
      } else {
        if (!leftRef.current || !rightRef.current) return
        const leftUri = monaco.Uri.parse(
          `inmemory://cga-pure/left/${instanceId}/${encodeURIComponent(filePath.replace(/^\//, ''))}`,
        )
        const rightUri = monaco.Uri.parse(
          `inmemory://cga-pure/right/${instanceId}/${encodeURIComponent(filePath.replace(/^\//, ''))}`,
        )
        const leftModel = monaco.editor.createModel(kind === 'deleted' ? content : '', language, leftUri)
        const rightModel = monaco.editor.createModel(kind === 'added' ? content : '', language, rightUri)
        const leftEditor = monaco.editor.create(leftRef.current, { model: leftModel, ...options })
        const rightEditor = monaco.editor.create(rightRef.current, { model: rightModel, ...options })

        const decoratedEditor = kind === 'added' ? rightEditor : leftEditor
        const decoratedModel = kind === 'added' ? rightModel : leftModel
        const collection = decoratedEditor.createDecorationsCollection(
          buildPureChangeDecorations(monaco, decoratedModel, kind),
        )

        next.editors.push(leftEditor, rightEditor)
        next.models.push(leftModel, rightModel)
        next.collections.push(collection)
        next.disposables.push(
          ...wireAddToChatForDiffEditor(leftEditor, filePath, language),
          ...wireAddToChatForDiffEditor(rightEditor, filePath, language),
        )
      }

      bundleRef.current = next
      // Re-apply the stored split ratio so freshly-mounted editors pick it up.
      if (!inline) applyRatio(ratioRef.current)
    }

    void run()

    return () => {
      live = false
      disposeEditorBundle(bundleRef.current)
      bundleRef.current = null
    }
  }, [appearanceThemeId, content, editorFontSize, filePath, inline, instanceId, kind, language, prefersReducedMotion, applyRatio])

  if (inline) {
    return (
      <div className={styles.diffScrollArea} style={{ overflow: 'hidden' }}>
        <div ref={hostRef} className={styles.fullFileEditorHost} />
      </div>
    )
  }

  return (
    <div className={styles.diffScrollArea} style={{ overflow: 'hidden' }}>
      <div
        ref={splitWrapRef}
        className={`${styles.fullFileSplit} ${isResizing ? styles.fullFileSplitResizing : ''}`}
      >
        <div
          ref={leftRef}
          className={`${styles.fullFileEditorHost} ${styles.fullFileSplitPane}`}
          style={{ flexBasis: `${ratio * 100}%` }}
        />
        <button
          type="button"
          className={`${styles.fullFileSplitHandle} ${isResizing ? styles.fullFileSplitHandleActive : ''}`}
          aria-label="Resize diff panes"
          aria-orientation="vertical"
          role="separator"
          onPointerDown={handleResizeStart}
          onDoubleClick={() => { setRatio(0.5); applyRatio(0.5) }}
        >
          <span className={styles.fullFileSplitGrip} aria-hidden="true" />
        </button>
        <div
          ref={rightRef}
          className={`${styles.fullFileEditorHost} ${styles.fullFileSplitPane}`}
          style={{ flex: '1 1 auto', minWidth: 0 }}
        />
      </div>
    </div>
  )
}

/**
 * Full-file HEAD vs worktree using Monaco’s imperative `createDiffEditor` + `createModel`.
 * We do **not** use `@monaco-editor/react`’s `<DiffEditor>`: its minified effect graph can
 * desync the two models (known symptom: a new file renders as an all-“deletion” red inline diff).
 */
export function FullFileDiffEditor({ filePath, worktreePath, status, originalRef }: Props) {
  const inline = useAppStore((s) => s.settings.diffInline)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const addToast = useAppStore((s) => s.addToast)
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const editorFontSize = useAppStore((s) => s.settings.editorFontSize)
  const prefersReducedMotion = usePrefersReducedMotion()

  const [original, setOriginal] = useState<string | null>(null)
  const [modified, setModified] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [unsupported, setUnsupported] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const instanceId = useId().replace(/:/g, '')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<{ original: editor.ITextModel, modified: editor.ITextModel } | null>(null)
  const diffChatDisposablesRef = useRef<IDisposable[]>([])
  const monacoRef = useRef<Awaited<ReturnType<typeof loader.init>> | null>(null)

  useEffect(() => {
    void loader.init().then((monaco) => {
      monacoRef.current = monaco
      ensureAppearanceMonacoThemes(monaco.editor)
    })
  }, [])

  const ref = originalRef ?? 'HEAD'

  const loadSides = useCallback(async () => {
    setLoading(true)
    setUnsupported(null)
    setOriginal(null)
    setModified(null)
    try {
      const absolutePath = joinWorktreeFile(worktreePath, filePath)
      const [headBlob, diskBlob] = await Promise.all([
        window.api.git.showFileAtHead(worktreePath, filePath).catch(() => null),
        window.api.fs.readFile(absolutePath).catch(() => null),
      ])

      const originalText = headBlob ?? ''
      const modifiedText = diskBlob ?? ''

      if (originalText.length > MAX_DIFF_FILE_BYTES || modifiedText.length > MAX_DIFF_FILE_BYTES) {
        setUnsupported('File is too large to diff. Open the raw file instead.')
        setLoading(false)
        return
      }

      if (looksBinary(originalText) || looksBinary(modifiedText)) {
        setUnsupported('Binary or non-text file. Open the raw file instead.')
        setLoading(false)
        return
      }

      setOriginal(originalText)
      setModified(modifiedText)
      setLoading(false)
    } catch (err) {
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(err, 'Failed to load diff'),
        type: 'error',
      })
      setLoading(false)
    }
  }, [filePath, worktreePath, addToast])

  useEffect(() => {
    void loadSides()
  }, [loadSides, reloadKey])

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ worktreePath?: string, paths?: string[] }>).detail
      if (detail?.worktreePath !== worktreePath) return
      if (detail.paths && !detail.paths.includes(filePath)) return
      setReloadKey((k) => k + 1)
    }
    window.addEventListener('git:files-changed', onChange)
    return () => window.removeEventListener('git:files-changed', onChange)
  }, [worktreePath, filePath])

  const language = useMemo(() => getLanguage(filePath), [filePath])
  const pureChangeKind = useMemo<'added' | 'deleted' | null>(() => {
    if (original == null || modified == null) return null
    if (original === '' && modified !== '') return 'added'
    if (original !== '' && modified === '') return 'deleted'
    return null
  }, [original, modified])

  const canShowDiff = !loading
    && !unsupported
    && original !== null
    && modified !== null
    && original !== modified

  function disposeDiff() {
    for (const d of diffChatDisposablesRef.current) {
      try { d.dispose() } catch { /* empty */ }
    }
    diffChatDisposablesRef.current = []
    const d = diffRef.current
    if (d) {
      try {
        d.setModel(null)
      } catch { /* empty */ }
      d.dispose()
      diffRef.current = null
    }
    if (modelsRef.current) {
      try {
        modelsRef.current.original.dispose()
        modelsRef.current.modified.dispose()
      } catch { /* empty */ }
      modelsRef.current = null
    }
  }

  // Imperative `createDiffEditor` only — the `@monaco-editor/react` `DiffEditor` component’s
  // effect batching can desync the two `ITextModel`s (new files showing as all “removals”).
  useEffect(() => {
    if (!canShowDiff) {
      disposeDiff()
      return
    }

    const el = containerRef.current
    if (!el) return

    disposeDiff()

    let live = true

    const run = async () => {
      const monaco = monacoRef.current ?? await loader.init()
      if (!live || !containerRef.current) return
      monacoRef.current = monaco
      ensureAppearanceMonacoThemes(monaco.editor)
      monaco.editor.setTheme(getAppearanceMonacoThemeName(appearanceThemeId))

      const diffOpts: editor.IStandaloneDiffEditorConstructionOptions = {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: !inline,
        ignoreTrimWhitespace: false,
        renderOverviewRuler: true,
        renderIndicators: true,
        renderMarginRevertIcon: false,
        fontFamily: "'SF Mono', Menlo, 'Cascadia Code', monospace",
        fontSize: editorFontSize,
        minimap: { enabled: false },
        scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
        padding: { top: 8, bottom: 8 },
        renderLineHighlight: 'line',
        cursorBlinking: prefersReducedMotion ? 'solid' : 'smooth',
        smoothScrolling: !prefersReducedMotion,
        automaticLayout: true,
        glyphMargin: false,
        lineNumbersMinChars: 2,
        lineDecorationsWidth: 4,
        fixedOverflowWidgets: true,
      }

      if (!containerRef.current) return
      const diffEditor = monaco.editor.createDiffEditor(containerRef.current, diffOpts)
      diffRef.current = diffEditor

      const uo = monaco.Uri.parse(
        `inmemory://cga-orig/${instanceId}/${encodeURIComponent(filePath.replace(/^\//, ''))}`,
      )
      const um = monaco.Uri.parse(
        `inmemory://cga-mod/${instanceId}/${encodeURIComponent(filePath.replace(/^\//, ''))}`,
      )
      const origModel = monaco.editor.createModel(original!, language, uo)
      const modModel = monaco.editor.createModel(modified!, language, um)
      modelsRef.current = { original: origModel, modified: modModel }
      diffEditor.setModel({ original: origModel, modified: modModel })

      // Wire Cmd+L (Add to Chat) on both panes so the shortcut works whether
      // the user has selected text on the HEAD side or the working-tree side.
      diffChatDisposablesRef.current = [
        ...wireAddToChatForDiffEditor(diffEditor.getOriginalEditor(), filePath, language),
        ...wireAddToChatForDiffEditor(diffEditor.getModifiedEditor(), filePath, language),
      ]
    }

    void run()

    return () => {
      live = false
      disposeDiff()
    }
  }, [
    canShowDiff,
    original,
    modified,
    language,
    inline,
    appearanceThemeId,
    editorFontSize,
    prefersReducedMotion,
    instanceId,
    filePath,
  ])

  const roRef = useRef<ResizeObserver | null>(null)
  useEffect(() => {
    if (!canShowDiff || !containerRef.current) {
      roRef.current?.disconnect()
      roRef.current = null
      return
    }
    const el = containerRef.current
    const ro = new ResizeObserver(() => {
      diffRef.current?.layout()
    })
    ro.observe(el)
    roRef.current = ro
    diffRef.current?.layout()
    return () => {
      ro.disconnect()
      roRef.current = null
    }
  }, [canShowDiff])

  const pillLabel = statusLabel(status)
  const pillClass = status ? styles[status] : ''
  const refLabel = ref === 'HEAD' ? 'HEAD' : ref.slice(0, 7)
  const { dir: pathDir, name: pathName } = useMemo(() => {
    const parts = filePath.split('/')
    const name = parts.pop() || filePath
    const dir = parts.length > 0 ? parts.join('/') + '/' : ''
    return { dir, name }
  }, [filePath])

  return (
    <div className={`${styles.diffViewerContainer} ${styles.fullFileDiffSurface}`}>
      <div className={styles.diffToolbar}>
        <span className={`${styles.diffFileCount} ${styles.fullFileDiffHeaderPath}`}>
          {pathDir && <span className={styles.fullFileDiffPathDir}>{pathDir}</span>}
          <span className={styles.fullFileDiffPathName}>{pathName}</span>
          {pillLabel && (
            <span className={`${styles.fullFileStatusPill} ${pillClass}`} aria-label={`Status: ${pillLabel}`}>
              {pillLabel}
            </span>
          )}
          <span className={styles.fullFileDiffRef}>{refLabel} ↔ working tree</span>
        </span>
        <div className={styles.diffToggle} role="group" aria-label="Diff layout">
          <button
            type="button"
            className={`${styles.diffToggleOption} ${!inline ? styles.active : ''}`}
            onClick={() => updateSettings({ diffInline: false })}
            aria-pressed={!inline}
          >
            Side by side
          </button>
          <button
            type="button"
            className={`${styles.diffToggleOption} ${inline ? styles.active : ''}`}
            onClick={() => updateSettings({ diffInline: true })}
            aria-pressed={inline}
          >
            Inline
          </button>
        </div>
      </div>

      {unsupported ? (
        <div className={styles.diffEmpty} role="status">
          <span className={styles.diffEmptyIcon}>⚠</span>
          <span className={styles.diffEmptyText}>{unsupported}</span>
        </div>
      ) : loading || original === null || modified === null ? (
        <div className={styles.diffEmpty} role="status" aria-live="polite">
          <span className={styles.fullFileDiffLoading}>
            <span className={styles.fullFileDiffLoadingDot} aria-hidden="true" />
            <span className={styles.diffEmptyText}>Loading diff</span>
          </span>
        </div>
      ) : original === modified ? (
        <div className={styles.diffEmpty} role="status">
          <span className={styles.diffEmptyIcon}>✓</span>
          <span className={styles.diffEmptyText}>No changes</span>
        </div>
      ) : pureChangeKind ? (
        <PureFileChangeSurface
          kind={pureChangeKind}
          content={pureChangeKind === 'added' ? modified : original}
          inline={inline}
          language={language}
          appearanceThemeId={appearanceThemeId}
          editorFontSize={editorFontSize}
          prefersReducedMotion={prefersReducedMotion}
          filePath={filePath}
        />
      ) : (
        <div
          className={styles.diffScrollArea}
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <div
            ref={containerRef}
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
            }}
          />
        </div>
      )}
    </div>
  )
}
