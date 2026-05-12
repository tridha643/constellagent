import { RocketLaunch } from '@phosphor-icons/react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { LinearIssueNode } from '../../linear/linear-api'
import type { Workspace } from '../../store/types'
import { Tooltip } from '../Tooltip/Tooltip'
import { PriorityGlyph } from './PriorityGlyph'
import { StateGlyph } from './StateGlyph'
import styles from './IssueRow.module.css'

interface IssueRowProps {
  issue: LinearIssueNode
  linkedWorkspace: Workspace | undefined
  isLinkedActive: boolean
  /** Click on the row / identifier pill. */
  onActivate: (issue: LinearIssueNode) => void
  /** Rocket action — open new worktree + agent for this issue. */
  onLaunchAgent: (issue: LinearIssueNode) => void
  /** 0 = top-level row, 1 = sub-issue rendered indented under its parent. */
  depth?: 0 | 1
}

export const ISSUE_DROPPABLE_PREFIX = 'issue:'

function initialsFor(name: string | undefined): string {
  if (!name) return ''
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts
    .map((p) => p[0]?.toUpperCase() ?? '')
    .filter(Boolean)
    .join('')
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const delta = Date.now() - t
  const sec = Math.round(delta / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const days = Math.round(hr / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(months / 12)}y`
}

/**
 * Single Linear issue row. Density + linked-workspace styling is driven via
 * data attributes so the parent scroll container can swap density cheaply
 * without remounting rows. The row is simultaneously a drag source (move to
 * another lane / row) and a drop target (become its parent).
 */
export function IssueRow({
  issue,
  linkedWorkspace,
  isLinkedActive,
  onActivate,
  onLaunchAgent,
  depth = 0,
}: IssueRowProps) {
  const dragId = `${ISSUE_DROPPABLE_PREFIX}${issue.id}`
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: dragId, data: { type: 'issue', issue } })
  const { setNodeRef: setDropRef, isOver, active } = useDroppable({
    id: dragId,
    data: { type: 'issue', issue },
  })

  // Combine the drag & drop refs onto the same DOM node so a row can be both
  // grabbed and used as a parent target.
  const setRef = (el: HTMLDivElement | null) => {
    setDragRef(el)
    setDropRef(el)
  }

  const linkState: 'active' | 'linked' | 'none' = isLinkedActive
    ? 'active'
    : linkedWorkspace
      ? 'linked'
      : 'none'

  const safeIdTestId = `linear-issue-id-${issue.identifier.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const title = linkedWorkspace
    ? `Open linked workspace: ${linkedWorkspace.name}`
    : `Open ${issue.identifier} in Linear`

  const assigneeInitials = initialsFor(issue.assignee?.name)
  const relative = formatRelative(issue.updatedAt ?? issue.createdAt)

  // Highlight as parent target only when another row is being dragged onto this one.
  const activeIsAnotherRow =
    active &&
    typeof active.id === 'string' &&
    active.id !== dragId &&
    String(active.id).startsWith(ISSUE_DROPPABLE_PREFIX)
  const dropActive = isOver && activeIsAnotherRow

  return (
    <div
      ref={setRef}
      className={styles.row}
      data-link-state={linkState}
      data-testid="linear-issue-row"
      data-depth={depth}
      data-is-subissue={depth === 1 ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      data-drop-active={dropActive ? 'true' : 'false'}
      {...attributes}
      {...listeners}
    >
      <span className={styles.accent} aria-hidden />
      <span className={styles.stateCell}>
        <StateGlyph state={issue.state} variant="icon" />
      </span>
      <button
        type="button"
        className={styles.identifier}
        data-testid={safeIdTestId}
        data-workspace-linked={linkedWorkspace ? 'true' : 'false'}
        onClick={() => onActivate(issue)}
        title={title}
      >
        {issue.identifier}
      </button>
      <button
        type="button"
        className={styles.title}
        onClick={() => onActivate(issue)}
        title={issue.title}
      >
        {issue.title}
      </button>
      <span className={styles.meta}>
        <span className={styles.metaPriority}>
          <PriorityGlyph priority={issue.priority} />
        </span>
        {issue.team ? (
          <span className={styles.teamChip} title={issue.team.name}>
            {issue.team.key}
          </span>
        ) : null}
        {assigneeInitials ? (
          <Tooltip label={issue.assignee?.name ?? 'Assignee'}>
            <span className={styles.assignee} aria-label={issue.assignee?.name}>
              {assigneeInitials}
            </span>
          </Tooltip>
        ) : null}
        {relative ? (
          <span className={styles.relative} title={issue.updatedAt ?? ''}>
            {relative}
          </span>
        ) : null}
      </span>
      <Tooltip label="New worktree and coding agent for this issue">
        <button
          type="button"
          className={styles.launchBtn}
          onClick={(e) => {
            // dnd-kit pointer activation distance prevents drag from firing on a
            // simple click, but stop propagation so the row's drag listener does
            // not consume the click event.
            e.stopPropagation()
            onLaunchAgent(issue)
          }}
          aria-label={`Open ${issue.identifier} in coding agent`}
        >
          <RocketLaunch size={14} aria-hidden weight="duotone" />
        </button>
      </Tooltip>
    </div>
  )
}
