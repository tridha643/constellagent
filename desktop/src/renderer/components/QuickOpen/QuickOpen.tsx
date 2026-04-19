import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../../store/app-store'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import type { QuickOpenSearchItem, QuickOpenSearchResult } from '../../../shared/quick-open-types'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import styles from './QuickOpen.module.css'

interface Props {
  worktreePath: string
}

const QUICK_OPEN_LIMIT = 50
const SEARCH_DEBOUNCE_MS = 80

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

export function QuickOpen({ worktreePath }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<QuickOpenSearchItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchState, setSearchState] = useState<QuickOpenSearchResult['state']>('ready')
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

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const currentFile = activeTab?.type === 'file' || activeTab?.type === 'markdownPreview'
    ? activeTab.filePath
    : undefined

  const openPath = useCallback(
    (path: string) => {
      if (isMarkdownDocumentPath(path)) openMarkdownPreview(path)
      else openFileTab(path)
    },
    [openFileTab, openMarkdownPreview],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const issuedQuery = query

    const runSearch = () => {
      void window.api.fs.quickOpenSearch(worktreePath, {
        query: issuedQuery,
        limit: QUICK_OPEN_LIMIT,
        currentFile,
      }).then((result) => {
        if (cancelled || requestId !== requestIdRef.current) return
        resolvedQueryRef.current = issuedQuery
        setResults(result.items)
        setSearchState(result.state)
        setHasLoaded(true)
      }).catch(() => {
        if (cancelled || requestId !== requestIdRef.current) return
        resolvedQueryRef.current = issuedQuery
        setResults([])
        setSearchState('error')
        setHasLoaded(true)
      })
    }

    setHasLoaded(false)
    const timeout = window.setTimeout(runSearch, issuedQuery.trim() ? SEARCH_DEBOUNCE_MS : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query, worktreePath, currentFile])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, worktreePath])

  useEffect(() => {
    if (results.length === 0) {
      setSelectedIndex(0)
      return
    }
    setSelectedIndex((index) => Math.min(index, results.length - 1))
  }, [results])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    if (item) item.scrollIntoView({ block: 'nearest', behavior: getPreferredScrollBehavior() })
  }, [selectedIndex])

  const openSelected = useCallback(() => {
    if (resolvedQueryRef.current !== query) return
    const item = results[selectedIndex]
    if (!item) return
    openPath(item.path)
    closeQuickOpen()
  }, [closeQuickOpen, openPath, query, results, selectedIndex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeQuickOpen()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((index) => Math.min(index + 1, results.length - 1))
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
  }, [closeQuickOpen, openSelected, results.length])

  const emptyMessage = !hasLoaded
    ? null
    : searchState === 'indexing'
      ? 'Indexing files...'
      : searchState === 'error'
        ? 'Search unavailable'
        : 'No matching files'

  return (
    <div className={styles.overlay} onClick={closeQuickOpen}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Search files by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div className={`${styles.results} stagger-children`} ref={listRef}>
          {results.length === 0 ? (
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
            results.map((item, index) => (
              <div
                key={item.path}
                className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                onClick={() => {
                  if (resolvedQueryRef.current !== query) return
                  openPath(item.path)
                  closeQuickOpen()
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={styles.resultIcon}>·</span>
                <HighlightedPath text={item.relativePath} query={query} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
