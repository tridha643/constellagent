import { ArrowSquareOut, MagnifyingGlass, Star, X } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import type {
  LinearProjectNode,
  LinearProjectUpdateNode,
} from '../../linear/linear-api'
import {
  buildLinearProjectSubviewUrl,
  linearOpenExternal,
} from '../../linear/linear-api'
import { Tooltip } from '../Tooltip/Tooltip'
import { matchesFffQuery } from './fff-text-match'
import styles from './ProjectsView.module.css'

interface ProjectsViewProps {
  projects: LinearProjectNode[]
  favoriteIds: Set<string>
  onToggleFavorite: (projectId: string) => void
  /** Updates cached by project id (used to surface the latest snippet, if any). */
  updatesByProjectId?: Record<string, LinearProjectUpdateNode[] | undefined>
  /** Hand off to Issues tab with scope set to this project. */
  onScopeIssues: (projectId: string) => void
  /** Displayed when the projects list is empty. */
  emptyState?: string
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

/**
 * Projects tab: card grid with favorite toggle, latest-update snippet (when cached),
 * "Open in Linear" and "Scope Issues" actions. Client-side text filter at the top.
 */
export function ProjectsView({
  projects,
  favoriteIds,
  onToggleFavorite,
  updatesByProjectId,
  onScopeIssues,
  emptyState = 'No projects loaded.',
}: ProjectsViewProps) {
  const [text, setText] = useState('')

  const filtered = useMemo(() => {
    const q = text.trim()
    const list = q
      ? projects.filter((p) => {
          const teams = p.teamSummaries ?? []
          const teamBlob = teams
            .map((t) => `${t.key} ${t.name}`)
            .join(' ')
          const hay = `${p.name} ${teamBlob}`.trim()
          return matchesFffQuery(hay, q)
        })
      : projects
    // Stable sort: favorites first, then alpha
    return [...list].sort((a, b) => {
      const af = favoriteIds.has(a.id) ? 0 : 1
      const bf = favoriteIds.has(b.id) ? 0 : 1
      if (af !== bf) return af - bf
      return a.name.localeCompare(b.name)
    })
  }, [projects, text, favoriteIds])

  return (
    <div className={styles.root}>
      <div className={styles.searchBar}>
        <label className={styles.searchWrap}>
          <MagnifyingGlass size={12} aria-hidden className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Filter projects…"
            aria-label="Filter projects by text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text ? (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setText('')}
              aria-label="Clear project search"
            >
              <X size={10} aria-hidden weight="bold" />
            </button>
          ) : null}
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {projects.length === 0 ? emptyState : 'No projects match that search.'}
        </div>
      ) : (
        <div className={styles.grid} data-testid="linear-projects-grid">
          {filtered.map((p) => {
            const favorite = favoriteIds.has(p.id)
            const updates = updatesByProjectId?.[p.id] ?? []
            const latest = updates[0]
            const snippet = latest?.body
              ? truncate(latest.body.replace(/\s+/g, ' ').trim(), 120)
              : null
            const teamSummary = p.teamSummaries
              ?.slice(0, 2)
              .map((t) => t.key)
              .join(' · ')
            const safeIdTestId = `linear-project-card-${p.slugId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
            return (
              <article
                key={p.id}
                className={styles.card}
                data-testid={safeIdTestId}
                data-favorite={favorite}
              >
                <header className={styles.cardHeader}>
                  <button
                    type="button"
                    className={styles.name}
                    onClick={() => onScopeIssues(p.id)}
                    title="Show this project's issues"
                  >
                    {p.name}
                  </button>
                  <Tooltip label={favorite ? 'Remove favorite' : 'Favorite'}>
                    <button
                      type="button"
                      className={styles.starBtn}
                      data-active={favorite}
                      aria-pressed={favorite}
                      onClick={() => onToggleFavorite(p.id)}
                      aria-label={favorite ? 'Remove favorite' : 'Favorite'}
                    >
                      <Star
                        size={14}
                        aria-hidden
                        weight={favorite ? 'fill' : 'regular'}
                      />
                    </button>
                  </Tooltip>
                </header>
                <div className={styles.meta}>
                  {teamSummary ? (
                    <span className={styles.teamChip}>{teamSummary}</span>
                  ) : null}
                  {p.organizationName ? (
                    <span className={styles.org}>{p.organizationName}</span>
                  ) : null}
                </div>
                {snippet ? (
                  <p className={styles.snippet}>{snippet}</p>
                ) : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.actionPrimary}
                    onClick={() => onScopeIssues(p.id)}
                  >
                    Scope Issues
                  </button>
                  <button
                    type="button"
                    className={styles.actionGhost}
                    onClick={() =>
                      void linearOpenExternal(
                        buildLinearProjectSubviewUrl(p, 'overview'),
                      )
                    }
                  >
                    <ArrowSquareOut size={12} aria-hidden weight="bold" />
                    <span>Open in Linear</span>
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
