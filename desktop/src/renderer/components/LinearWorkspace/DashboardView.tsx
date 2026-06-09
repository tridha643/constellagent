import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  linearIssueSetState,
  type LinearIssueNode,
  type LinearWorkflowStateType,
} from '../../linear/linear-api'
import type { LinearIssueStateType, Workspace } from '../../store/types'
import { EMPTY_LINEAR_ISSUE_FILTERS } from '../../store/types'
import { groupIssuesByState, type IssueListRow } from './group-issues-by-state'
import { DashboardCard } from './DashboardCard'
import { ISSUE_DROPPABLE_PREFIX } from './IssueRow'
import { STATE_DROPPABLE_PREFIX } from './IssueStateGroup'
import { StateGlyph } from './StateGlyph'
import { findWorkspaceForLinearIssue } from './workspace-for-linear-issue'
import styles from './DashboardView.module.css'

interface DashboardViewProps {
  issues: LinearIssueNode[]
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  apiKey: string
  onActivateIssue: (issue: LinearIssueNode) => void
  onLaunchAgent: (issue: LinearIssueNode) => void
  /** Optimistic local patch for a single issue (parent panel applies to both
   *  assigned + created arrays). Required for drag-and-drop to feel instant;
   *  the drag handler calls it again with the inverse patch on failure. */
  onLocalIssueUpdate?: (id: string, patch: Partial<LinearIssueNode>) => void
}

const TOAST_MS = 4000

/**
 * Fixed left→right column order for the board. `triage` is prepended only when
 * issues actually sit in it, so workspaces that don't use Triage never show an
 * empty Triage column. Labels mirror the reference screenshots.
 */
const DASHBOARD_COLUMNS: { type: LinearIssueStateType; label: string }[] = [
  { type: 'backlog', label: 'Backlog' },
  { type: 'unstarted', label: 'Todo' },
  { type: 'started', label: 'In Progress' },
  { type: 'completed', label: 'Done' },
  { type: 'canceled', label: 'Canceled' },
]

function dragIdToIssueId(id: string | number | null | undefined): string | null {
  if (typeof id !== 'string') return null
  if (!id.startsWith(ISSUE_DROPPABLE_PREFIX)) return null
  return id.slice(ISSUE_DROPPABLE_PREFIX.length)
}

/** One state column: a droppable lane with a header (glyph + label, no count). */
function DashboardColumn({
  type,
  label,
  children,
}: {
  type: LinearIssueStateType
  label: string
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${STATE_DROPPABLE_PREFIX}${type}`,
    data: { type: 'state', stateType: type },
  })
  return (
    <section
      ref={setNodeRef}
      className={styles.column}
      data-state-type={type}
      data-drop-active={isOver ? 'true' : 'false'}
    >
      <header className={styles.columnHeader}>
        <StateGlyph
          state={{ name: label, type }}
          variant="icon"
          size={14}
          showTooltip={false}
        />
        <span className={styles.columnLabel}>{label}</span>
      </header>
      <div className={styles.columnBody}>{children}</div>
    </section>
  )
}

/**
 * Dashboard tab body: a horizontal kanban grouped by Linear workflow-state type.
 * Dragging a card between columns changes the issue's state (optimistic +
 * rollback on failure) via the same {@link linearIssueSetState} mutation the
 * Issues list uses. This board is independent of the sidebar "sections".
 */
export function DashboardView({
  issues,
  workspaces,
  activeWorkspaceId,
  apiKey,
  onActivateIssue,
  onLaunchAgent,
  onLocalIssueUpdate,
}: DashboardViewProps) {
  const issueById = useMemo(() => {
    const m = new Map<string, LinearIssueNode>()
    for (const i of issues) m.set(i.id, i)
    return m
  }, [issues])

  // Reuse the Issues list grouping (filters off) for bucketing + sub-issue
  // flattening + sorting, then index by state type so we can render a fixed
  // column set including empty columns.
  const rowsByType = useMemo(() => {
    const groups = groupIssuesByState(issues, EMPTY_LINEAR_ISSUE_FILTERS)
    const m = new Map<LinearIssueStateType, IssueListRow[]>()
    for (const g of groups) m.set(g.stateType, g.rows)
    return m
  }, [issues])

  const columns = useMemo(() => {
    const hasTriage = (rowsByType.get('triage')?.length ?? 0) > 0
    return hasTriage
      ? [{ type: 'triage' as LinearIssueStateType, label: 'Triage' }, ...DASHBOARD_COLUMNS]
      : DASHBOARD_COLUMNS
  }, [rowsByType])

  // --- drag-and-drop ---------------------------------------------------------
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)
  const activeIssue = activeIssueId ? issueById.get(activeIssueId) ?? null : null

  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  // 6px activation distance keeps clicks (title, identifier, rocket) usable
  // while still letting the card become draggable on a small pointer move.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  // Only state columns are droppable here, so prefer pointer-within and fall
  // back to rect-intersection, keeping just the state lanes as candidates.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const hits = pointerWithin(args)
    const candidates = hits.length ? hits : rectIntersection(args)
    return candidates.filter(
      (c) =>
        typeof c.id === 'string' && c.id.startsWith(STATE_DROPPABLE_PREFIX),
    )
  }, [])

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveIssueId(dragIdToIssueId(e.active.id as string))
  }, [])

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const issueId = dragIdToIssueId(e.active.id as string)
      setActiveIssueId(null)
      if (!issueId) return
      const overId = e.over?.id
      if (!overId || typeof overId !== 'string') return
      if (!overId.startsWith(STATE_DROPPABLE_PREFIX)) return

      const issue = issueById.get(issueId)
      if (!issue) return

      const targetType = overId.slice(
        STATE_DROPPABLE_PREFIX.length,
      ) as LinearWorkflowStateType
      const currentType = (issue.state?.type ?? '').toLowerCase()
      if (currentType === targetType) return // no-op

      if (!issue.team?.id) {
        showToast('This issue has no team — open it in Linear to move it.')
        return
      }

      const prevState = issue.state
      onLocalIssueUpdate?.(issueId, {
        state: { name: prevState?.name ?? targetType, type: targetType },
      })

      void linearIssueSetState(apiKey, issue, targetType).then((res) => {
        if (res.ok) return
        onLocalIssueUpdate?.(issueId, { state: prevState })
        showToast(`Couldn't move issue: ${res.error}`)
      })
    },
    [apiKey, issueById, onLocalIssueUpdate, showToast],
  )

  const onDragCancel = useCallback(() => setActiveIssueId(null), [])

  const hasAnyIssues = issues.length > 0

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className={styles.root}>
        {!hasAnyIssues ? (
          <div className={styles.empty}>
            {apiKey.trim()
              ? 'No issues in this view.'
              : 'Connect Linear in Settings.'}
          </div>
        ) : (
          <div className={styles.board} data-testid="linear-dashboard-board">
            {columns.map((col) => {
              const rows = rowsByType.get(col.type) ?? []
              return (
                <DashboardColumn
                  key={col.type}
                  type={col.type}
                  label={col.label}
                >
                  {rows.map((row) => {
                    const linked = findWorkspaceForLinearIssue(
                      row.issue,
                      workspaces,
                    )
                    return (
                      <DashboardCard
                        key={row.issue.id}
                        issue={row.issue}
                        linkedWorkspace={linked}
                        isLinkedActive={linked?.id === activeWorkspaceId}
                        onActivate={onActivateIssue}
                        onLaunchAgent={onLaunchAgent}
                      />
                    )
                  })}
                </DashboardColumn>
              )
            })}
          </div>
        )}
        {toast ? (
          <div className={styles.toast} role="status">
            {toast}
          </div>
        ) : null}
      </div>
      <DragOverlay
        dropAnimation={{
          duration: 220,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        {activeIssue ? (
          <div className={styles.dragGhost} data-testid="linear-dashboard-drag-ghost">
            <StateGlyph state={activeIssue.state} variant="icon" size={13} showTooltip={false} />
            <span className={styles.dragGhostTitle}>{activeIssue.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
