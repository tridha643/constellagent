import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../../store/app-store'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import type { QuickOpenSearchItem, QuickOpenSearchResult } from '../../../shared/quick-open-types'
import type { CodeSearchItem, CodeSearchResult } from '../../../shared/code-search-types'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import styles from './QuickOpen.module.css'

interface Props {
  worktreePath: string
}

const QUICK_OPEN_LIMIT = 50
const FILE_SIDE_LIMIT = 25
const CODE_SIDE_LIMIT = 25
const SEARCH_DEBOUNCE_MS = 80

/** Unified row rendered by the palette: either a file-name hit or a code-content hit. */
type PaletteItem =
  | {
      kind: 'file'
      path: string
      relativePath: string
      fileName: string
      score: number
      matchType?: string
      exactMatch?: boolean
    }
  | {
      kind: 'code'
      path: string
      relativePath: string
      fileName: string
      lineNumber: number
      column: number
      preview: string
      matchRanges?: [number, number][]
      order: number
    }

type CodeSideState = 'idle' | 'ready' | 'indexing' | 'error'

function fuzzyMatch(query: string, target: string): number[] | null {
  const lowerQuery = query.trim().toLowerCase()
  if (!lowerQuery) return []

  const lowerTarget = target.toLowerCase()
  const indices: number[] = []
  let qi = 0

  for (let ti = 0; ti < lowerTarget.length && qi < lowerQuery.length; ti += 1) {
    if (lowerTarget[ti] === lowerQuery[qi]) {
      indices.push(ti)
      qi += 1
    }
  }

  return qi === lowerQuery.length ? indices : null
}

function HighlightedPath({ text, query }: { text: string; query: string }) {
  const indices = fuzzyMatch(query, text) ?? []
  const set = new Set(indices)
  const lastSlash = text.lastIndexOf('/')
  const dir = lastSlash >= 0 ? text.slice(0, lastSlash + 1) : ''
  const name = lastSlash >= 0 ? text.slice(lastSlash + 1) : text

  const renderChars = (value: string, offset: number) =>
    value.split('').map((ch, index) => {
      const globalIndex = offset + index
      return set.has(globalIndex) ? (
        <span key={globalIndex} className={styles.matchChar}>{ch}</span>
      ) : (
        <span key={globalIndex}>{ch}</span>
      )
    })

  return (
    <span className={styles.resultPath}>
      {dir && <span className={styles.resultDir}>{renderChars(dir, 0)}</span>}
      <span className={styles.resultName}>{renderChars(name, dir.length)}</span>
    </span>
  )
}

/** Render a code preview line with highlight ranges from fff's grep output. */
function HighlightedPreview({
  preview,
  matchRanges,
}: {
  preview: string
  matchRanges?: [number, number][]
}) {
  if (!matchRanges || matchRanges.length === 0) {
    return <span className={styles.resultPreview}>{preview}</span>
  }
  // Normalize + sort ranges; clip to preview bounds.
  const ranges = [...matchRanges]
    .map(([start, end]) => [Math.max(0, start), Math.min(preview.length, end)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])

  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(<span key={`t${i}`}>{preview.slice(cursor, start)}</span>)
    parts.push(
      <span key={`m${i}`} className={styles.matchChar}>
        {preview.slice(start, end)}
      </span>,
    )
    cursor = end
  })
  if (cursor < preview.length) parts.push(<span key="tail">{preview.slice(cursor)}</span>)
  return <span className={styles.resultPreview}>{parts}</span>
}

export function QuickOpen({ worktreePath }: Props) {
  const editorFindContext = useAppStore((s) => s.editorFindContext)
  const quickOpenInitialQuery = useAppStore((s) => s.quickOpenInitialQuery)
  // Seed query from the editor selection on mount when opened from Cmd+F in editor.
  const [query, setQuery] = useState(() => quickOpenInitialQuery ?? '')
  const [fileResults, setFileResults] = useState<QuickOpenSearchItem[]>([])
  const [codeResults, setCodeResults] = useState<CodeSearchItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchState, setSearchState] = useState<QuickOpenSearchResult['state']>('ready')
  const [codeState, setCodeState] = useState<CodeSideState>('idle')
  const [hasLoaded, setHasLoaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)
  const resolvedQueryRef = useRef('')
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const closeQuickOpen = useAppStore((s) => s.closeQuickOpen)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tabs = useAppStore((s) => s.tabs)
  const codeSearchSetting = useAppStore((s) => s.settings.quickOpenCodeSearchEnabled)

  const editorFindFilePath = editorFindContext?.filePath ?? null
  const inEditorFindMode = editorFindFilePath !== null
  // In editor-find mode the kind pill + code rows are always relevant so we
  // render them unconditionally; outside editor-find the settings toggle gates
  // both the code request and the surface area.
  const codeSearchEnabled = inEditorFindMode || codeSearchSetting
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  // fff reads from disk; flag unsaved edits so we can warn + de-rank code rows.
  const editorFileTab = inEditorFindMode
    ? tabs.find((tab) => tab.type === 'file' && tab.filePath === editorFindFilePath)
    : undefined
  const editorFileDirty = editorFileTab?.type === 'file' ? Boolean(editorFileTab.unsaved) : false
  const currentFile = activeTab?.type === 'file' || activeTab?.type === 'markdownPreview'
    ? activeTab.filePath
    : undefined

  const openPath = useCallback(
    (path: string, opts?: { initialPosition?: { lineNumber: number; column: number } }) => {
      if (isMarkdownDocumentPath(path)) openMarkdownPreview(path)
      else openFileTab(path, opts)
    },
    [openFileTab, openMarkdownPreview],
  )

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    // Pre-select a seeded query so the user can type to overwrite it — matches
    // the behaviour of Monaco's native find widget when opened on a selection.
    if (input.value.length > 0) input.select()
  }, [])

  useEffect(() => {
    let cancelled = false
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const issuedQuery = query
    const trimmed = issuedQuery.trim()
    const runCodeSearch = codeSearchEnabled && trimmed.length > 0

    const runSearch = () => {
      const filePromise: Promise<QuickOpenSearchResult> = window.api.fs.quickOpenSearch(worktreePath, {
        query: issuedQuery,
        limit: runCodeSearch ? FILE_SIDE_LIMIT : QUICK_OPEN_LIMIT,
        currentFile,
      })
      const codePromise: Promise<CodeSearchResult | null> = runCodeSearch
        ? window.api.fs.codeSearch(worktreePath, {
            query: trimmed,
            mode: 'plain',
            limit: CODE_SIDE_LIMIT,
            scope: editorFindFilePath
              ? { kind: 'activeFile', filePath: editorFindFilePath }
              : { kind: 'workspace' },
          })
        : Promise.resolve(null)

      void Promise.allSettled([filePromise, codePromise]).then(([fileOutcome, codeOutcome]) => {
        if (cancelled || requestId !== requestIdRef.current) return
        resolvedQueryRef.current = issuedQuery

        if (fileOutcome.status === 'fulfilled') {
          setFileResults(fileOutcome.value.items)
          setSearchState(fileOutcome.value.state)
        } else {
          setFileResults([])
          setSearchState('error')
        }

        if (!runCodeSearch) {
          setCodeResults([])
          setCodeState('idle')
        } else if (codeOutcome.status === 'fulfilled' && codeOutcome.value) {
          setCodeResults(codeOutcome.value.items)
          setCodeState(codeOutcome.value.state)
        } else {
          setCodeResults([])
          setCodeState('error')
        }

        setHasLoaded(true)
      })
    }

    setHasLoaded(false)
    const timeout = window.setTimeout(runSearch, trimmed ? SEARCH_DEBOUNCE_MS : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query, worktreePath, currentFile, codeSearchEnabled, editorFindFilePath])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, worktreePath])

  // Editor-find mode: code first by default because the user is already inside
  // the file and wants in-file hits; flip to files-first when the buffer is
  // dirty so disk-stale code rows don't sit above fresh file hits.
  const codeFirst = inEditorFindMode && !editorFileDirty
  const combinedResults = buildCombinedResults(fileResults, codeResults, { codeFirst })

  useEffect(() => {
    if (combinedResults.length === 0) {
      setSelectedIndex(0)
      return
    }
    setSelectedIndex((index) => Math.min(index, combinedResults.length - 1))
  }, [combinedResults.length])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    if (item) item.scrollIntoView({ block: 'nearest', behavior: getPreferredScrollBehavior() })
  }, [selectedIndex])

  const openSelected = useCallback(() => {
    if (resolvedQueryRef.current !== query) return
    const item = combinedResults[selectedIndex]
    if (!item) return
    if (item.kind === 'code') {
      // In editor-find mode all code rows point at the pinned file; this is a
      // no-op for that case but keeps intent explicit if fff ever returns rows
      // from elsewhere (e.g. symlinked paths).
      const targetPath = editorFindFilePath ?? item.path
      openPath(targetPath, { initialPosition: { lineNumber: item.lineNumber, column: item.column } })
    } else {
      openPath(item.path)
    }
    closeQuickOpen()
  }, [closeQuickOpen, openPath, query, combinedResults, selectedIndex, editorFindFilePath])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeQuickOpen()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((index) => Math.min(index + 1, combinedResults.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      openSelected()
    }
  }, [closeQuickOpen, openSelected, combinedResults.length])

  const emptyMessage = !hasLoaded
    ? null
    : searchState === 'indexing'
      ? 'Indexing files...'
      : searchState === 'error'
        ? 'Search unavailable'
        : 'No matching files'

  const codeFooter = codeSearchEnabled && hasLoaded && query.trim().length > 0
    ? codeState === 'indexing'
      ? 'Indexing code…'
      : codeState === 'error'
        ? 'Code search unavailable'
        : null
    : null

  // Dirty-file hint: fff is disk-based, so unsaved buffer changes are invisible
  // to it. Show a single quiet line so the user understands why a match they
  // "just typed" might not appear. Pairs with the files-first ranking flip.
  const dirtyFindHint = inEditorFindMode && editorFileDirty
    ? 'Unsaved edits in this file aren’t searched'
    : null
  const footerMessage = dirtyFindHint ?? codeFooter

  const inputPlaceholder = inEditorFindMode
    ? 'Find in this file or open another...'
    : codeSearchEnabled
      ? 'Search files or code...'
      : 'Search files by name...'

  return (
    <div className={styles.overlay} onClick={closeQuickOpen}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder={inputPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div className={`${styles.results} stagger-children`} ref={listRef}>
          {combinedResults.length === 0 ? (
            <div className={styles.empty}>
              {!hasLoaded ? (
                <div
                  role="status"
                  aria-busy="true"
                  aria-label="Loading search results"
                  style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', width: '100%' }}
                >
                  <div className="shimmer-block" style={{ width: '72%', height: 13 }} />
                  <div className="shimmer-block" style={{ width: '56%', height: 13 }} />
                </div>
              ) : (
                emptyMessage
              )}
            </div>
          ) : (
            combinedResults.map((item, index) => {
              const key = item.kind === 'code'
                ? `code:${item.path}:${item.lineNumber}:${item.column}`
                : `file:${item.path}`
              const selected = index === selectedIndex
              const onClick = () => {
                if (resolvedQueryRef.current !== query) return
                if (item.kind === 'code') {
                  const targetPath = editorFindFilePath ?? item.path
                  openPath(targetPath, { initialPosition: { lineNumber: item.lineNumber, column: item.column } })
                } else {
                  openPath(item.path)
                }
                closeQuickOpen()
              }
              return (
                <div
                  key={key}
                  className={`${styles.resultItem} ${selected ? styles.selected : ''} ${item.kind === 'code' ? styles.resultItemCode : ''}`}
                  onClick={onClick}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className={styles.resultIcon}>·</span>
                  {codeSearchEnabled && (
                    <span
                      className={`${styles.resultKind} ${item.kind === 'code' ? styles.resultKindCode : styles.resultKindFile}`}
                    >
                      {item.kind}
                    </span>
                  )}
                  <div className={styles.resultMeta}>
                    <span className={styles.resultHeadline}>
                      <HighlightedPath text={item.relativePath} query={query} />
                      {item.kind === 'code' && (
                        <span className={styles.resultLine}>L{item.lineNumber}</span>
                      )}
                    </span>
                    {item.kind === 'code' && (
                      <HighlightedPreview preview={item.preview} matchRanges={item.matchRanges} />
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
        {footerMessage && (
          <div className={styles.footer}>{footerMessage}</div>
        )}
      </div>
    </div>
  )
}

/**
 * Merge file-name and code-content hits into a single list.
 *
 * - File rows keep their existing fff ranking (sorted lowest score wins in fff).
 * - Code rows preserve fff's own intra-code order.
 * - Section ordering is controlled by `codeFirst`. Editor-find mode defaults
 *   to code first (the user is already inside the file and typing to locate a
 *   passage); the worktree-wide entry keeps files first. When the active file
 *   is dirty, the caller flips back to files-first so fff's disk-stale rows
 *   don't sit above fresh name hits.
 * - Result is capped at QUICK_OPEN_LIMIT.
 */
function buildCombinedResults(
  files: QuickOpenSearchItem[],
  code: CodeSearchItem[],
  opts: { codeFirst?: boolean } = {},
): PaletteItem[] {
  const filePart: PaletteItem[] = files.map((file) => ({
    kind: 'file' as const,
    path: file.path,
    relativePath: file.relativePath,
    fileName: file.fileName,
    score: file.score,
    matchType: file.matchType,
    exactMatch: file.exactMatch,
  }))

  const codePart: PaletteItem[] = code.map((match, order) => ({
    kind: 'code' as const,
    path: match.path,
    relativePath: match.relativePath,
    fileName: match.fileName,
    lineNumber: match.lineNumber,
    column: match.column,
    preview: match.preview,
    matchRanges: match.matchRanges,
    order,
  }))

  const out = opts.codeFirst ? [...codePart, ...filePart] : [...filePart, ...codePart]
  return out.slice(0, QUICK_OPEN_LIMIT)
}
