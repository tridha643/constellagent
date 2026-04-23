import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../../store/app-store'
import type { LinearIssueNode } from '../../linear/linear-api'
import type {
  LinearIssueFilters,
  LinearIssueStateType,
  Workspace,
} from '../../store/types'
import {
  LINEAR_ISSUE_STATE_TYPES,
  normalizeLinearIssueStateGroupsCollapsed,
} from '../../store/types'
import { groupIssuesByState } from './group-issues-by-state'
import { IssueFilters, type IssueFiltersHandle } from './IssueFilters'
import { IssueRow } from './IssueRow'
import { IssueStateGroup } from './IssueStateGroup'
import { findWorkspaceForLinearIssue } from './workspace-for-linear-issue'
import styles from './IssuesView.module.css'

interface IssuesViewProps {
  issues: LinearIssueNode[]
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  apiKey: string
  onActivateIssue: (issue: LinearIssueNode) => void
  onLaunchAgent: (issue: LinearIssueNode) => void
}

/**
 * Issues tab body: filter chips, grouped-by-state list, scroll container.
 * Filter/density/collapsed state live in settings; scope + text search
 * update the store immediately so refreshes are consistent with the panel.
 */
export function IssuesView({
  issues,
  workspaces,
  activeWorkspaceId,
  apiKey,
  onActivateIssue,
  onLaunchAgent,
}: IssuesViewProps) {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const filtersRef = useRef<IssueFiltersHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const filters = settings.linearIssueFilters
  const density = settings.linearIssueDensity
  const scope = settings.linearIssueScope

  const collapsed = useMemo(
    () => new Set(normalizeLinearIssueStateGroupsCollapsed(settings.linearIssueStateGroupsCollapsed)),
    [settings.linearIssueStateGroupsCollapsed],
  )

  const availableTeamKeys = useMemo(() => {
    const s = new Set<string>()
    for (const i of issues) if (i.team?.key) s.add(i.team.key)
    return [...s].sort()
  }, [issues])

  const groups = useMemo(
    () => groupIssuesByState(issues, filters),
    [issues, filters],
  )

  const hasAnyIssues = issues.length > 0
  const hasFilteredResults = groups.length > 0

  const setFilters = useCallback(
    (next: LinearIssueFilters) => {
      updateSettings({ linearIssueFilters: next })
    },
    [updateSettings],
  )

  const toggleCollapsed = useCallback(
    (st: LinearIssueStateType) => {
      const set = new Set(collapsed)
      set.has(st) ? set.delete(st) : set.add(st)
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

  // Keyboard shortcuts scoped to this view: `/` focus search, `[`/`]` collapse/expand all, `v` cycles density.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        filtersRef.current?.focusSearch()
        return
      }
      if (e.key === '[') {
        e.preventDefault()
        collapseAll()
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        expandAll()
        return
      }
      if (e.key === 'v') {
        e.preventDefault()
        updateSettings({
          linearIssueDensity: density === 'compact' ? 'comfortable' : 'compact',
        })
      }
    }
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [collapseAll, expandAll, density, updateSettings])

  return (
    <div className={styles.root}>
      <div className={styles.filtersBar}>
        <IssueFilters
          ref={filtersRef}
          scope={scope}
          onScopeChange={(s) => updateSettings({ linearIssueScope: s })}
          filters={filters}
          onFiltersChange={setFilters}
          density={density}
          onDensityChange={(d) => updateSettings({ linearIssueDensity: d })}
          availableTeamKeys={availableTeamKeys}
        />
      </div>
      <div
        ref={scrollRef}
        className={styles.scroll}
        data-density={density}
        tabIndex={-1}
      >
        {!hasAnyIssues ? (
          <div className={styles.empty}>
            {apiKey.trim() ? 'No issues in this view.' : 'Connect Linear in Settings.'}
          </div>
        ) : !hasFilteredResults ? (
          <div className={styles.empty}>No issues match your filters.</div>
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
                {group.issues.map((issue) => {
                  const linked = findWorkspaceForLinearIssue(issue, workspaces)
                  return (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      linkedWorkspace={linked}
                      isLinkedActive={linked?.id === activeWorkspaceId}
                      onActivate={onActivateIssue}
                      onLaunchAgent={onLaunchAgent}
                    />
                  )
                })}
              </IssueStateGroup>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
