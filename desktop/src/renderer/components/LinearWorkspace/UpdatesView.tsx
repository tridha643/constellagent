import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import type { LinearProjectUpdateNode } from '../../linear/linear-api'
import { matchesFffQuery } from './fff-text-match'
import {
  LinearSearchComposer,
  type LinearSearchComposerProps,
} from './LinearSearchComposer'
import { UpdateCard } from './UpdateCard'
import styles from './UpdatesView.module.css'

interface UpdatesViewProps {
  composerProps: LinearSearchComposerProps
  projectUpdates: LinearProjectUpdateNode[]
  updatesLoading: boolean
  updatesError: string | null
  scopeProjectId: string
  selectedProjectName?: string
}

/**
 * Updates tab body: composer on top, timeline of recent project updates
 * for the scoped project below. Each update is rendered as a floating
 * card so the list feels at home in the new panel aesthetic.
 */
export function UpdatesView({
  composerProps,
  projectUpdates,
  updatesLoading,
  updatesError,
  scopeProjectId,
  selectedProjectName,
}: UpdatesViewProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim()
    if (!q) return projectUpdates
    return projectUpdates.filter((u) => {
      const author = u.user?.displayName || u.user?.name || ''
      const hay = `${author} ${u.body ?? ''}`
      return matchesFffQuery(hay, q)
    })
  }, [projectUpdates, search])

  const hasAnyUpdates = projectUpdates.length > 0
  const listLabel = selectedProjectName?.trim()
    ? `Recent updates in ${selectedProjectName}`
    : 'Recent updates'

  return (
    <div className={styles.root}>
      <div className={styles.composer}>
        <LinearSearchComposer {...composerProps} />
      </div>

      <section className={styles.listSection}>
        <header className={styles.listHeader}>
          <h2 className={styles.listTitle}>
            <span>{listLabel}</span>
            {hasAnyUpdates ? (
              <span className={styles.count}>{projectUpdates.length}</span>
            ) : null}
          </h2>
          {scopeProjectId && hasAnyUpdates ? (
            <label className={styles.searchWrap}>
              <MagnifyingGlass
                size={13}
                className={styles.searchIcon}
                aria-hidden
              />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Filter updates…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Filter updates"
              />
              {search ? (
                <button
                  type="button"
                  className={styles.searchClear}
                  onClick={() => setSearch('')}
                  aria-label="Clear filter"
                >
                  <X size={10} aria-hidden weight="bold" />
                </button>
              ) : null}
            </label>
          ) : null}
        </header>

        <div className={styles.scroll}>
          {!scopeProjectId ? (
            <div className={styles.empty}>
              Pick a project above to see its update history.
            </div>
          ) : updatesLoading && !hasAnyUpdates ? (
            <div className={styles.empty}>Loading updates…</div>
          ) : updatesError ? (
            <div className={styles.empty} title={updatesError}>
              {updatesError}
            </div>
          ) : !hasAnyUpdates ? (
            <div className={styles.empty}>
              No project updates yet — be the first to post one.
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>No updates match your filter.</div>
          ) : (
            <div
              className={styles.timeline}
              data-testid="linear-updates-timeline"
            >
              {filtered.map((update) => (
                <UpdateCard key={update.id} update={update} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
