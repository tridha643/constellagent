import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useAppStore } from '../../store/app-store'
import {
  relativePathInWorktree,
  pathsEqualOrAlias,
  type AgentPlanEntry,
  type AgentPlanSearchItem,
  type AgentPlanSearchResult,
} from '../../../shared/agent-plan-path'
import { GeminiIcon } from '../Icons/GeminiIcon'
import { CursorIcon } from '../Icons/CursorIcon'
import { OpenCodeIcon } from '../Icons/OpenCodeIcon'
import { PiIcon } from '../Icons/PiIcon'
import claudeIcon from '../../assets/agent-icons/claude.svg'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import openaiIcon from '../../assets/agent-icons/openai.svg'
import qoStyles from '../QuickOpen/QuickOpen.module.css'
import styles from './PlanPalette.module.css'

interface PlanEntry extends AgentPlanEntry {}

export interface PlanPaletteWorktreeOption {
  path: string
  label: string
}

interface Props {
  worktreePath: string
  /** All worktrees in the current project (used to load plans and filter by checkout). */
  projectWorktrees: PlanPaletteWorktreeOption[]
}

type AgentFilter = 'all' | 'cursor' | 'claude-code' | 'codex' | 'gemini' | 'opencode' | 'pi-constell'
type WorktreeFilterKey = 'all' | '__home__' | string

const AGENTS: { key: AgentFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'claude-code', label: 'Claude' },
  { key: 'codex', label: 'Codex' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'opencode', label: 'OpenCode' },
  { key: 'pi-constell', label: 'PI Constell' },
]

const PLAN_PALETTE_CACHE = new Map<string, PlanEntry[]>()
const PLAN_SEARCH_LIMIT = 200
const SEARCH_DEBOUNCE_MS = 80

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

function relPath(p: string, base: string, userHome: string | null): string {
  if (userHome) {
    const relH = relativePathInWorktree(userHome, p)
    if (relH !== null) return `~/${relH}`
  }
  return p.startsWith(base) ? p.slice(base.length + 1) : p
}

function formatAge(mtimeMs: number): string {
  const delta = Date.now() - mtimeMs
  const mins = Math.floor(delta / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function entryMatchesWorktree(
  entry: PlanEntry | AgentPlanSearchItem,
  filter: WorktreeFilterKey,
  userHome: string | null,
  activeWorktree: string,
): boolean {
  if (filter === 'all') return true
  if (filter === '__home__') {
    if (userHome && entry.planSourceRoot && pathsEqualOrAlias(entry.planSourceRoot, userHome)) return true
    if (!entry.planSourceRoot && userHome) {
      return (
        relativePathInWorktree(userHome, entry.path) !== null
        && relativePathInWorktree(activeWorktree, entry.path) === null
      )
    }
    return false
  }
  if (entry.planSourceRoot && pathsEqualOrAlias(entry.planSourceRoot, filter)) return true
  if (!entry.planSourceRoot) return relativePathInWorktree(filter, entry.path) !== null
  return false
}

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

function HighlightedPlanPath({ text, query }: { text: string; query: string }) {
  const indices = fuzzyMatch(query, text) ?? []
  const set = new Set(indices)
  const lastSlash = text.lastIndexOf('/')
  const dir = lastSlash >= 0 ? text.slice(0, lastSlash + 1) : ''
  const name = lastSlash >= 0 ? text.slice(lastSlash + 1) : text

  const renderChars = (value: string, offset: number) =>
    value.split('').map((ch, index) => {
      const globalIndex = offset + index
      return set.has(globalIndex) ? (
        <span key={globalIndex} className={qoStyles.matchChar}>{ch}</span>
      ) : (
        <span key={globalIndex}>{ch}</span>
      )
    })

  return (
    <span className={qoStyles.resultPath}>
      {dir && <span className={qoStyles.resultDir}>{renderChars(dir, 0)}</span>}
      <span className={qoStyles.resultName}>{renderChars(name, dir.length)}</span>
    </span>
  )
}

function AgentChipIcon({ agent }: { agent: AgentFilter }) {
  if (agent === 'all') return null
  if (agent === 'claude-code') return <img src={claudeIcon} alt="Claude" />
  if (agent === 'codex') return <img src={openaiIcon} alt="Codex" />
  if (agent === 'gemini') return <GeminiIcon />
  if (agent === 'cursor') return <CursorIcon />
  if (agent === 'opencode') return <OpenCodeIcon />
  if (agent === 'pi-constell') return <PiIcon />
  return null
}

function AgentRowIcon({ agent }: { agent: string }) {
  if (agent === 'claude-code') return <img src={claudeIcon} alt="" style={{ width: 14, height: 14 }} />
  if (agent === 'codex') return <img src={openaiIcon} alt="" style={{ width: 14, height: 14 }} />
  if (agent === 'gemini') return <GeminiIcon className={qoStyles.resultIcon} />
  if (agent === 'cursor') return <CursorIcon className={qoStyles.resultIcon} />
  if (agent === 'opencode') return <OpenCodeIcon className={qoStyles.resultIcon} />
  if (agent === 'pi-constell') return <PiIcon className={qoStyles.resultIcon} />
  return <span className={qoStyles.resultIcon}>·</span>
}

function dedupeWorktreeScanPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (!p) continue
    const k = p.replace(/\/+$/, '') || '/'
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

export function PlanPalette({ worktreePath, projectWorktrees }: Props) {
  const [query, setQuery] = useState('')
  const [plans, setPlans] = useState<PlanEntry[]>([])
  const [searchedPlans, setSearchedPlans] = useState<AgentPlanSearchItem[]>([])
  const [searchState, setSearchState] = useState<AgentPlanSearchResult['state']>('ready')
  const [hasSearchLoaded, setHasSearchLoaded] = useState(false)
  const [userHome, setUserHome] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const [worktreeFilter, setWorktreeFilter] = useState<WorktreeFilterKey>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)
  const resolvedQueryRef = useRef('')
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const closePlanPalette = useAppStore((s) => s.closePlanPalette)

  const pathsToScan = useMemo(() => {
    const raw = projectWorktrees.length > 0 ? projectWorktrees.map((w) => w.path) : [worktreePath]
    return dedupeWorktreeScanPaths(raw)
  }, [projectWorktrees, worktreePath])

  const scanKey = pathsToScan.join('\0')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    void window.api.app.getHomeDir().then(setUserHome).catch(() => setUserHome(null))
  }, [])

  useEffect(() => {
    let cancelled = false
    const cached = PLAN_PALETTE_CACHE.get(scanKey)
    if (cached) setPlans(cached)

    window.api.fs.listAgentPlanMarkdowns(pathsToScan).then((entries) => {
      if (cancelled) return
      PLAN_PALETTE_CACHE.set(scanKey, entries)
      setPlans(entries)
    }).catch(() => {})

    return () => { cancelled = true }
  }, [scanKey, pathsToScan])

  useEffect(() => {
    if (!query.trim()) {
      resolvedQueryRef.current = ''
      setSearchedPlans([])
      setSearchState('ready')
      setHasSearchLoaded(false)
      return
    }

    let cancelled = false
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const issuedQuery = query

    const runSearch = () => {
      void window.api.fs.searchAgentPlans(pathsToScan, {
        query: issuedQuery,
        limit: PLAN_SEARCH_LIMIT,
      }).then((result) => {
        if (cancelled || requestId !== requestIdRef.current) return
        resolvedQueryRef.current = issuedQuery
        setSearchedPlans(result.items)
        setSearchState(result.state)
        setHasSearchLoaded(true)
      }).catch(() => {
        if (cancelled || requestId !== requestIdRef.current) return
        resolvedQueryRef.current = issuedQuery
        setSearchedPlans([])
        setSearchState('error')
        setHasSearchLoaded(true)
      })
    }

    setHasSearchLoaded(false)
    const timeout = window.setTimeout(runSearch, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query, pathsToScan])

  const visiblePlans = query.trim() ? searchedPlans : plans

  const filtered = useMemo(() => {
    let list = visiblePlans
    if (worktreeFilter !== 'all') {
      list = list.filter((p) => entryMatchesWorktree(p, worktreeFilter, userHome, worktreePath))
    }
    if (agentFilter !== 'all') {
      list = list.filter((p) => p.agent === agentFilter)
    }
    return list.slice(0, 50)
  }, [visiblePlans, agentFilter, worktreeFilter, userHome, worktreePath])

  useEffect(() => { setSelectedIndex(0) }, [query, agentFilter, worktreeFilter])

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
    if (query.trim() && resolvedQueryRef.current !== query) return
    const entry = filtered[selectedIndex]
    if (entry) {
      openMarkdownPreview(entry.path)
      closePlanPalette()
    }
  }, [closePlanPalette, filtered, openMarkdownPreview, query, selectedIndex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closePlanPalette()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openSelected()
    }
  }, [closePlanPalette, filtered.length, openSelected])

  const displayBaseForEntry = useCallback(
    (entry: PlanEntry | AgentPlanSearchItem) => entry.planSourceRoot ?? worktreePath,
    [worktreePath],
  )

  const emptyMessage = !query.trim()
    ? (plans.length === 0 ? 'No plan files found' : 'No matching plans')
    : !hasSearchLoaded
      ? null
      : searchState === 'indexing'
        ? 'Indexing plans...'
        : searchState === 'error'
          ? 'Search unavailable'
          : searchedPlans.length === 0
            ? 'No matching plans'
            : 'No plans match the current filters'

  return (
    <div className={qoStyles.overlay} onClick={closePlanPalette}>
      <div className={`${qoStyles.panel} ${styles.planPanel}`} onClick={(e) => e.stopPropagation()}>
        <div className={qoStyles.inputWrap}>
          <input
            ref={inputRef}
            className={qoStyles.input}
            type="text"
            placeholder="Search plans with fff..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>

        <div className={styles.filterSection} role="group" aria-label="Plan filters">
          <div className={styles.filterRow}>
            <span className={styles.filterGroupLabel}>Worktree</span>
            <div className={styles.filterChips}>
              <button
                type="button"
                className={`${styles.chip} ${worktreeFilter === 'all' ? styles.chipActive : ''}`}
                onClick={() => setWorktreeFilter('all')}
                tabIndex={-1}
              >
                All
              </button>
              {projectWorktrees.map((w) => (
                <button
                  key={w.path}
                  type="button"
                  className={`${styles.chip} ${worktreeFilter === w.path ? styles.chipActive : ''}`}
                  onClick={() => setWorktreeFilter(w.path)}
                  tabIndex={-1}
                  title={w.path}
                >
                  {pathsEqualOrAlias(w.path, worktreePath) ? `${w.label} (active)` : w.label}
                </button>
              ))}
              <button
                type="button"
                className={`${styles.chip} ${worktreeFilter === '__home__' ? styles.chipActive : ''}`}
                onClick={() => setWorktreeFilter('__home__')}
                tabIndex={-1}
                title={userHome ? `Plans under ${userHome}` : 'User home plan folders'}
              >
                Home (~)
              </button>
            </div>
          </div>
          <div className={styles.filterRow}>
            <span className={styles.filterGroupLabel}>Agent folder</span>
            <div className={styles.filterChips}>
              {AGENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={`${styles.chip} ${agentFilter === a.key ? styles.chipActive : ''}`}
                  onClick={() => setAgentFilter(a.key)}
                  tabIndex={-1}
                >
                  {a.key !== 'all' && (
                    <span className={styles.chipIcon}><AgentChipIcon agent={a.key} /></span>
                  )}
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={`${qoStyles.results} stagger-children`} ref={listRef}>
          {filtered.length === 0 ? (
            <div className={qoStyles.empty}>
              {query.trim() && !hasSearchLoaded ? (
                <div
                  role="status"
                  aria-busy="true"
                  aria-label="Loading plan search results"
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
            filtered.map((entry, i) => {
              const base = displayBaseForEntry(entry)
              const rel = relPath(entry.path, base, userHome)
              return (
                <div
                  key={entry.path}
                  className={`${qoStyles.resultItem} ${i === selectedIndex ? qoStyles.selected : ''}`}
                  onClick={() => {
                    if (query.trim() && resolvedQueryRef.current !== query) return
                    openMarkdownPreview(entry.path)
                    closePlanPalette()
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <AgentRowIcon agent={entry.agent} />
                  <HighlightedPlanPath text={rel} query={query} />
                  {entry.codingAgent && (
                    <span className={styles.agentLabel} title={entry.codingAgent}>{entry.codingAgent}</span>
                  )}
                  {entry.built ? (
                    <span className={`${styles.builtPill} ${styles.builtYes}`}>Built ✓</span>
                  ) : (
                    <span className={styles.builtPill}>Not built</span>
                  )}
                  <span className={styles.meta}>{formatAge(entry.mtimeMs)}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
