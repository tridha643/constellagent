import { useEffect, useMemo, useRef, useState } from 'react'
import {
  filterAndSortJumpRows,
  fuzzyMatchSubsequence,
  linearFffIndexKey,
  linearFffIndexSyncHash,
  linearJumpRowsFromSearchIssues,
  linearJumpRowsFromSearchProjects,
  linearJumpRowsToFffIndexEntries,
  LINEAR_JUMP_RESULT_LIMIT,
  LINEAR_REMOTE_SEARCH_MIN_CHARS,
  mergeLinearJumpRows,
  rankJumpRowsFromFffPaths,
  type LinearJumpRow,
} from '../../linear/linear-jump-index'
import {
  linearRemoteIssueSearchAudience,
  normalizeLinearQuickOpenQuery,
} from '../../linear/linear-quick-open-path'
import {
  linearSearchIssues,
  linearSearchProjects,
  type LinearProjectNode,
  type LinearUserNode,
} from '../../linear/linear-api'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import { useAppStore } from '../../store/app-store'
import styles from './LinearQuickOpen.module.css'

const SEARCH_DEBOUNCE_MS = 80
const REMOTE_SEARCH_DEBOUNCE_MS = 260

function HighlightedFuzzyText({
  text,
  query,
  variant,
}: {
  text: string
  query: string
  variant: 'title' | 'subtitle'
}) {
  const q = query.trim()
  const className = variant === 'title' ? styles.fuzzyTitle : styles.fuzzySubtitle
  if (!q) {
    return <span className={className}>{text}</span>
  }
  const indices = new Set(fuzzyMatchSubsequence(q, text) ?? [])
  return (
    <span className={className}>
      {text.split('').map((ch, index) =>
        indices.has(index) ? (
          <span key={index} className={styles.fuzzyMatch}>
            {ch}
          </span>
        ) : (
          <span key={index}>{ch}</span>
        ),
      )}
    </span>
  )
}

export interface LinearQuickOpenProps {
  apiKey: string
  /** Authenticated Linear user (from API key); scopes default remote issue search to their issues. */
  viewer: { id: string; name: string } | null
  jumpRows: LinearJumpRow[]
  projects: LinearProjectNode[]
  pickerUsers: LinearUserNode[]
  orgUsersUnavailable: boolean
  onActivateRow: (row: LinearJumpRow) => void
}

export function LinearQuickOpen({
  apiKey,
  viewer,
  jumpRows,
  projects,
  pickerUsers,
  orgUsersUnavailable,
  onActivateRow,
}: LinearQuickOpenProps) {
  const visible = useAppStore((s) => s.linearQuickOpenVisible)
  const closeLinearQuickOpen = useAppStore((s) => s.closeLinearQuickOpen)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LinearJumpRow[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [remoteSearchLoading, setRemoteSearchLoading] = useState(false)
  const [remoteSearchError, setRemoteSearchError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const remoteSeqRef = useRef(0)
  const resolvedQueryRef = useRef('')

  const fuzzyQ = useMemo(() => normalizeLinearQuickOpenQuery(query), [query])

  useEffect(() => {
    if (!visible) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest', behavior: getPreferredScrollBehavior() })
  }, [visible])

  useEffect(() => {
    if (!visible) return

    let cancelled = false
    const seq = remoteSeqRef.current + 1
    remoteSeqRef.current = seq
    const issued = query
    const fq = normalizeLinearQuickOpenQuery(issued)
    const key = apiKey.trim()

    const applyResults = (rows: LinearJumpRow[]) => {
      if (cancelled || seq !== remoteSeqRef.current) return
      resolvedQueryRef.current = issued
      setResults(rows)
    }

    const rankWithFff = async (merged: LinearJumpRow[]) => {
      if (!fq.trim()) {
        applyResults(merged.slice(0, LINEAR_JUMP_RESULT_LIMIT))
        return
      }
      const entries = linearJumpRowsToFffIndexEntries(merged)
      const syncHash = linearFffIndexSyncHash(entries)
      if (entries.length === 0) {
        applyResults(filterAndSortJumpRows(merged, fq))
        return
      }
      try {
        const res = await window.api.linearFffQuickOpen({
          indexKey: linearFffIndexKey(key || 'no-key'),
          syncHash,
          entries,
          query: fq,
          limit: LINEAR_JUMP_RESULT_LIMIT,
        })
        if (cancelled || seq !== remoteSeqRef.current) return
        if (res.error || res.state === 'error') {
          applyResults(filterAndSortJumpRows(merged, fq))
          return
        }
        const byPath = new Map(
          merged.filter((r) => r.fffRelativePath).map((r) => [r.fffRelativePath!, r]),
        )
        const ordered = rankJumpRowsFromFffPaths(res.relativePaths, res.scores, byPath)
        if (ordered.length === 0) {
          applyResults(filterAndSortJumpRows(merged, fq))
        } else {
          applyResults(ordered)
        }
      } catch {
        if (cancelled || seq !== remoteSeqRef.current) return
        applyResults(filterAndSortJumpRows(merged, fq))
      }
    }

    if (fq.length < LINEAR_REMOTE_SEARCH_MIN_CHARS || !key) {
      const t = window.setTimeout(() => {
        void (async () => {
          setRemoteSearchLoading(false)
          setRemoteSearchError(null)
          await rankWithFff(jumpRows)
        })()
      }, fq ? SEARCH_DEBOUNCE_MS : 0)
      return () => {
        cancelled = true
        window.clearTimeout(t)
      }
    }

    setRemoteSearchLoading(true)
    setRemoteSearchError(null)
    const t = window.setTimeout(() => {
      void (async () => {
        const issueAudience = linearRemoteIssueSearchAudience(fq, viewer, pickerUsers)
        const [ir, pr] = await Promise.all([
          linearSearchIssues(key, fq, { audience: issueAudience }),
          linearSearchProjects(key, fq),
        ])
        if (cancelled || seq !== remoteSeqRef.current) return

        const issuesFailed = Boolean(ir.errors?.length)
        const projectsFailed = Boolean(pr.errors?.length)
        if (issuesFailed && projectsFailed) {
          const msg = [...(ir.errors ?? []), ...(pr.errors ?? [])].map((e) => e.message).join('; ')
          await rankWithFff(jumpRows)
          if (cancelled || seq !== remoteSeqRef.current) return
          resolvedQueryRef.current = issued
          setRemoteSearchError(msg)
          setRemoteSearchLoading(false)
          return
        }

        const partialMsg: string[] = []
        if (issuesFailed) partialMsg.push(ir.errors!.map((e) => e.message).join('; '))
        if (projectsFailed) partialMsg.push(pr.errors!.map((e) => e.message).join('; '))

        const issueRows = linearJumpRowsFromSearchIssues(ir.issues ?? [])
        const projectRows = linearJumpRowsFromSearchProjects(pr.projects ?? [])
        const merged = mergeLinearJumpRows(jumpRows, [...issueRows, ...projectRows])
        await rankWithFff(merged)
        if (cancelled || seq !== remoteSeqRef.current) return
        resolvedQueryRef.current = issued
        setRemoteSearchError(partialMsg.length ? partialMsg.join(' · ') : null)
        setRemoteSearchLoading(false)
      })()
    }, REMOTE_SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [visible, query, jumpRows, apiKey, viewer, pickerUsers])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, jumpRows])

  useEffect(() => {
    if (results.length === 0) {
      setSelectedIndex(0)
      return
    }
    setSelectedIndex((i) => Math.min(i, results.length - 1))
  }, [results])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    if (item) item.scrollIntoView({ block: 'nearest', behavior: getPreferredScrollBehavior() })
  }, [selectedIndex])

  const openSelected = () => {
    if (resolvedQueryRef.current !== query) return
    const row = results[selectedIndex]
    if (!row) return
    onActivateRow(row)
    closeLinearQuickOpen()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeLinearQuickOpen()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      openSelected()
    }
  }

  if (!visible) return null

  return (
    <div
      className={styles.layer}
      data-testid="linear-quick-open"
      onClick={() => closeLinearQuickOpen()}
    >
      <div className={styles.embedCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.hint}>
          {viewer?.name ? ` Searching as ${viewer.name}.` : null}
          {orgUsersUnavailable ? ' Workspace directory unavailable; people list is from loaded issues.' : null}
        </div>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder={
              viewer?.name?.trim()
                ? `Search… (your issues by default · as ${viewer.name.trim()})`
                : 'Search issues, projects, people…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="linear-quick-open-input"
            autoFocus
            aria-busy={remoteSearchLoading}
          />
          {remoteSearchLoading ? (
            <span className={styles.remoteStatus} aria-live="polite">
              Searching…
            </span>
          ) : null}
        </div>
        {remoteSearchError ? (
          <div className={styles.remoteError} role="status">
            {remoteSearchError}
          </div>
        ) : null}
        <div className={styles.results} ref={listRef}>
          {results.length === 0 ? (
            <div className={styles.empty}>
              {jumpRows.length === 0
                ? 'Nothing loaded yet. Refresh or adjust your search.'
                : 'No matching items for your search.'}
            </div>
          ) : (
            results.map((row, index) => (
              <div
                key={row.id}
                className={`${styles.resultRow} ${index === selectedIndex ? styles.resultRowSelected : ''}`}
                onClick={() => {
                  if (resolvedQueryRef.current !== query) return
                  onActivateRow(row)
                  closeLinearQuickOpen()
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={styles.resultBullet}>·</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <HighlightedFuzzyText text={row.title} query={fuzzyQ} variant="title" />
                  <HighlightedFuzzyText text={row.subtitle} query={fuzzyQ} variant="subtitle" />
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
