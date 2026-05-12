import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useAppStore } from '../../store/app-store'
import {
  linearIssueSetParent,
  linearIssueSetState,
  type LinearIssueNode,
  type LinearWorkflowStateType,
} from '../../linear/linear-api'
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
import { IssueRow, ISSUE_DROPPABLE_PREFIX } from './IssueRow'
import { IssueStateGroup, STATE_DROPPABLE_PREFIX } from './IssueStateGroup'
import { findWorkspaceForLinearIssue } from './workspace-for-linear-issue'
import styles from './IssuesView.module.css'

interface IssuesViewProps {
  issues: LinearIssueNode[]
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  apiKey: string
  onActivateIssue: (issue: LinearIssueNode) => void
  onLaunchAgent: (issue: LinearIssueNode) => void
  /**
   * Optimistic local patch for a single issue, applied to both `assigned` and
   * `created` arrays in the parent panel. Required for drag-and-drop to feel
   * instant; the drag handler also calls this with the inverse patch on
   * mutation failure.
   */
  onLocalIssueUpdate?: (id: string, patch: Partial<LinearIssueNode>) => void
}

const TOAST_MS = 4000

function dragIdToIssueId(id: string | number | null | undefined): string | null {
  if (typeof id !== 'string') return null
  if (!id.startsWith(ISSUE_DROPPABLE_PREFIX)) return null
  return id.slice(ISSUE_DROPPABLE_PREFIX.length)
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
  onLocalIssueUpdate,
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

  const issueById = useMemo(() => {
    const m = new Map<string, LinearIssueNode>()
    for (const i of issues) m.set(i.id, i)
    return m
  }, [issues])

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

  const autoExpand = useCallback(
    (st: LinearIssueStateType) => {
      if (!collapsed.has(st)) return
      const next = [...collapsed].filter((x) => x !== st)
      updateSettings({ linearIssueStateGroupsCollapsed: next })
    },
    [collapsed, updateSettings],
  )

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

  // --- drag-and-drop state ---------------------------------------------------
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)
  const activeIssue = activeIssueId ? issueById.get(activeIssueId) ?? null : null
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  // 6px activation distance keeps clicks (identifier pill, title, rocket) usable
  // while still letting the row become draggable on a small pointer move.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  // pointer-within (primary) with a rectIntersection fallback. When the pointer
  // hovers a row but inside its outer 20%, route the drop to the enclosing
  // state group so a drag aimed between rows doesn't accidentally create a
  // sub-issue parent relationship.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const candidates = pointerWithin(args)
    const fallback = candidates.length ? candidates : rectIntersection(args)
    if (!fallback.length) return fallback

    const pointer = args.pointerCoordinates
    if (!pointer) return fallback

    const filtered = fallback.filter((c) => {
      const id = c.id
      if (typeof id !== 'string') return true
      if (!id.startsWith(ISSUE_DROPPABLE_PREFIX)) return true
      const entry = args.droppableContainers.find((d) => d.id === id)
      const rect = entry?.rect.current
      if (!rect) return true
      const innerInset = rect.height * 0.2
      const innerTop = rect.top + innerInset
      const innerBottom = rect.bottom - innerInset
      return pointer.y >= innerTop && pointer.y <= innerBottom
    })
    // Prefer row hits when a row passes the inner-60% test; otherwise fall back
    // to state-group hits so the outer edges still route to the lane.
    const rowHits = filtered.filter(
      (c) => typeof c.id === 'string' && c.id.startsWith(ISSUE_DROPPABLE_PREFIX),
    )
    if (rowHits.length) return rowHits
    return fallback.filter(
      (c) =>
        typeof c.id === 'string' && c.id.startsWith(STATE_DROPPABLE_PREFIX),
    )
  }, [])

  const onDragStart = useCallback((e: DragStartEvent) => {
    const issueId = dragIdToIssueId(e.active.id as string)
    setActiveIssueId(issueId)
  }, [])

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const issueId = dragIdToIssueId(e.active.id as string)
      setActiveIssueId(null)
      if (!issueId) return
      const overId = e.over?.id
      if (!overId || typeof overId !== 'string') return

      const issue = issueById.get(issueId)
      if (!issue) return

      // --- drop on a state-group header → change state (+ optionally un-parent) ---
      if (overId.startsWith(STATE_DROPPABLE_PREFIX)) {
        const targetType = overId.slice(
          STATE_DROPPABLE_PREFIX.length,
        ) as LinearWorkflowStateType
        const currentType = (issue.state?.type ?? '').toLowerCase()
        const sameType = currentType === targetType
        const hadParent = !!issue.parent?.id

        if (sameType && !hadParent) return // no-op

        if (!sameType && !issue.team?.id) {
          showToast('This issue has no team — open it in Linear to move it.')
          return
        }

        const prevState = issue.state
        const prevParent = issue.parent ?? null
        const optimisticState = sameType
          ? prevState
          : { name: prevState?.name ?? targetType, type: targetType }
        onLocalIssueUpdate?.(issueId, {
          state: optimisticState,
          parent: null,
        })

        void linearIssueSetState(apiKey, issue, targetType, {
          clearParent: hadParent,
        }).then((res) => {
          if (res.ok) return
          // Revert.
          onLocalIssueUpdate?.(issueId, {
            state: prevState,
            parent: prevParent,
          })
          showToast(`Couldn't move issue: ${res.error}`)
        })
        return
      }

      // --- drop on another row → set it as the parent ---
      if (overId.startsWith(ISSUE_DROPPABLE_PREFIX)) {
        const targetId = overId.slice(ISSUE_DROPPABLE_PREFIX.length)
        if (targetId === issueId) return // self
        if (issue.parent?.id === targetId) return // already that parent

        // Cycle guard: walk target's parent chain via the local issue map; if
        // it leads back to the dragged issue, abort.
        let cur: string | undefined = targetId
        const seen = new Set<string>()
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          if (cur === issueId) {
            showToast(
              "Can't make an issue a sub-issue of its own descendant.",
            )
            return
          }
          cur = issueById.get(cur)?.parent?.id
        }

        const prevParent = issue.parent ?? null
        onLocalIssueUpdate?.(issueId, { parent: { id: targetId } })

        void linearIssueSetParent(apiKey, issueId, targetId).then((res) => {
          if (res.ok) return
          onLocalIssueUpdate?.(issueId, { parent: prevParent })
          showToast(`Couldn't set sub-issue: ${res.error}`)
        })
      }
    },
    [apiKey, issueById, onLocalIssueUpdate, showToast],
  )

  const onDragCancel = useCallback(() => {
    setActiveIssueId(null)
  }, [])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
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
                  count={group.rows.length}
                  collapsed={collapsed.has(group.stateType)}
                  onToggle={toggleCollapsed}
                  onAutoExpand={autoExpand}
                >
                  {group.rows.map((row) => {
                    const linked = findWorkspaceForLinearIssue(
                      row.issue,
                      workspaces,
                    )
                    return (
                      <IssueRow
                        key={row.issue.id}
                        issue={row.issue}
                        linkedWorkspace={linked}
                        isLinkedActive={linked?.id === activeWorkspaceId}
                        onActivate={onActivateIssue}
                        onLaunchAgent={onLaunchAgent}
                        depth={row.depth}
                      />
                    )
                  })}
                </IssueStateGroup>
              ))}
            </div>
          )}
          {toast ? (
            <div className={styles.toast} role="status">
              {toast}
            </div>
          ) : null}
        </div>
      </div>
      <DragOverlay
        dropAnimation={{
          duration: 180,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        {activeIssue ? (
          <div className={styles.dragGhost} data-testid="linear-issue-drag-ghost">
            <span className={styles.dragGhostId}>{activeIssue.identifier}</span>
            <span className={styles.dragGhostTitle}>{activeIssue.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
