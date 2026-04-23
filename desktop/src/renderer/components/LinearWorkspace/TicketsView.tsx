import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { useCallback, useMemo, useState } from 'react'
import type { LinearIssueNode } from '../../linear/linear-api'
import { useAppStore } from '../../store/app-store'
import {
  EMPTY_LINEAR_ISSUE_FILTERS,
  LINEAR_ISSUE_STATE_TYPES,
  normalizeLinearIssueStateGroupsCollapsed,
  type LinearIssueStateType,
} from '../../store/types'
import { groupIssuesByState } from './group-issues-by-state'
import { IssueRow } from './IssueRow'
import { IssueStateGroup } from './IssueStateGroup'
import {
  LinearTicketsComposer,
  type LinearTicketsComposerProps,
} from './LinearTicketsComposer'
import styles from './TicketsView.module.css'

interface TicketsViewProps {
  composerProps: LinearTicketsComposerProps
  ticketIssues: LinearIssueNode[]
  ticketIssuesLoading: boolean
  ticketIssuesError: string | null
  scopeProjectId: string
  selectedProjectName?: string
  onActivateIssue: (issue: LinearIssueNode) => void
  onLaunchAgent: (issue: LinearIssueNode) => void
}

/**
 * Tickets tab body: composer at the top, grouped-by-state list of the
 * scoped project's existing tickets below. Mirrors the floating-card
 * visual system used by the Issues tab so the two feel unified.
 */
export function TicketsView({
  composerProps,
  ticketIssues,
  ticketIssuesLoading,
  ticketIssuesError,
  scopeProjectId,
  selectedProjectName,
  onActivateIssue,
  onLaunchAgent,
}: TicketsViewProps) {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const density = settings.linearIssueDensity
  const [search, setSearch] = useState('')

  const collapsed = useMemo(
    () =>
      new Set(
        normalizeLinearIssueStateGroupsCollapsed(
          settings.linearIssueStateGroupsCollapsed,
        ),
      ),
    [settings.linearIssueStateGroupsCollapsed],
  )

  const groups = useMemo(
    () =>
      groupIssuesByState(ticketIssues, {
        ...EMPTY_LINEAR_ISSUE_FILTERS,
        text: search,
      }),
    [ticketIssues, search],
  )

  const toggleCollapsed = useCallback(
    (st: LinearIssueStateType) => {
      const set = new Set(collapsed)
      if (set.has(st)) set.delete(st)
      else set.add(st)
      updateSettings({ linearIssueStateGroupsCollapsed: [...set] })
    },
    [collapsed, updateSettings],
  )

  const collapseAll = useCallback(() => {
    updateSettings({
      linearIssueStateGroupsCollapsed: [...LINEAR_ISSUE_STATE_TYPES],
    })
  }, [updateSettings])

  const expandAll = useCallback(() => {
    updateSettings({ linearIssueStateGroupsCollapsed: [] })
  }, [updateSettings])

  const hasAnyTickets = ticketIssues.length > 0
  const hasFilteredResults = groups.length > 0
  const listLabel = selectedProjectName?.trim()
    ? `Recent tickets in ${selectedProjectName}`
    : 'Recent tickets'

  return (
    <div className={styles.root}>
      <div className={styles.composer}>
        <LinearTicketsComposer {...composerProps} />
      </div>

      <section className={styles.listSection}>
        <header className={styles.listHeader}>
          <h2 className={styles.listTitle}>
            <span>{listLabel}</span>
            {hasAnyTickets ? (
              <span className={styles.count}>{ticketIssues.length}</span>
            ) : null}
          </h2>
          {scopeProjectId ? (
            <div className={styles.toolbar}>
              <label className={styles.searchWrap}>
                <MagnifyingGlass
                  size={13}
                  className={styles.searchIcon}
                  aria-hidden
                />
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Filter tickets…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Filter tickets"
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
              <div className={styles.toolbarButtons}>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={collapseAll}
                  title="Collapse all groups"
                >
                  Collapse
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={expandAll}
                  title="Expand all groups"
                >
                  Expand
                </button>
              </div>
            </div>
          ) : null}
        </header>

        <div className={styles.scroll} data-density={density}>
          {!scopeProjectId ? (
            <div className={styles.empty}>
              Pick a project above to see its recent tickets.
            </div>
          ) : ticketIssuesLoading && !hasAnyTickets ? (
            <div className={styles.empty}>Loading tickets…</div>
          ) : ticketIssuesError ? (
            <div className={styles.empty} title={ticketIssuesError}>
              {ticketIssuesError}
            </div>
          ) : !hasAnyTickets ? (
            <div className={styles.empty}>No tickets for this project yet.</div>
          ) : !hasFilteredResults ? (
            <div className={styles.empty}>No tickets match your filter.</div>
          ) : (
            <div className={styles.groups}>
              {groups.map((group) => (
                <IssueStateGroup
                  key={group.stateType}
                  stateType={group.stateType}
                  label={group.label}
                  count={group.issues.length}
                  collapsed={collapsed.has(group.stateType)}
                  onToggle={toggleCollapsed}
                >
                  {group.issues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      linkedWorkspace={undefined}
                      isLinkedActive={false}
                      onActivate={onActivateIssue}
                      onLaunchAgent={onLaunchAgent}
                    />
                  ))}
                </IssueStateGroup>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
