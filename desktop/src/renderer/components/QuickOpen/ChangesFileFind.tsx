import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useAppStore } from '../../store/app-store'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import {
  cancelChangesFileFindSelection,
  completeChangesFileFindSelection,
} from '../../utils/changes-file-find-bridge'
import styles from './QuickOpen.module.css'

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

function matchScore(path: string, indices: number[]): number {
  const nameStart = path.lastIndexOf('/') + 1
  const nameMatchCount = indices.filter((i) => i >= nameStart).length
  return nameMatchCount * 10 - indices.length - path.length
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

export function ChangesFileFind() {
  const changesFileFind = useAppStore((s) => s.changesFileFind)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!changesFileFind) return
    setQuery('')
    setSelectedIndex(0)
    queueMicrotask(() => inputRef.current?.focus())
  }, [changesFileFind])

  const filtered = useMemo(() => {
    if (!changesFileFind) return []
    const q = query.trim().toLowerCase()
    const paths = [...changesFileFind.paths]
    if (!q) return paths.slice(0, 50)

    const scored: { path: string; score: number }[] = []
    for (const path of paths) {
      const indices = fuzzyMatch(query, path)
      if (!indices || indices.length === 0) continue
      scored.push({ path, score: matchScore(path, indices) })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.map((s) => s.path).slice(0, 50)
  }, [changesFileFind, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, changesFileFind?.worktreePath])

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedIndex(0)
      return
    }
    setSelectedIndex((index) => Math.min(index, filtered.length - 1))
  }, [filtered])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    if (item) item.scrollIntoView({ block: 'nearest', behavior: getPreferredScrollBehavior() })
  }, [selectedIndex])

  const openSelected = useCallback(() => {
    const path = filtered[selectedIndex]
    if (path) completeChangesFileFindSelection(path)
  }, [filtered, selectedIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelChangesFileFindSelection()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1))
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
    },
    [filtered.length, openSelected],
  )

  if (!changesFileFind) return null

  return (
    <div className={styles.overlay} onClick={() => cancelChangesFileFindSelection()}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Find changed file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div className={styles.results} ref={listRef}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {changesFileFind.paths.length === 0 ? 'No changed files' : 'No matching files'}
            </div>
          ) : (
            filtered.map((path, index) => (
              <div
                key={path}
                className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                onClick={() => completeChangesFileFindSelection(path)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={styles.resultIcon}>·</span>
                <HighlightedPath text={path} query={query} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
