import { RocketLaunch } from '@phosphor-icons/react'
import { useDraggable } from '@dnd-kit/core'
import type { LinearIssueNode } from '../../linear/linear-api'
import type { Workspace } from '../../store/types'
import { Tooltip } from '../Tooltip/Tooltip'
import { StateGlyph } from './StateGlyph'
import { ISSUE_DROPPABLE_PREFIX } from './IssueRow'
import styles from './DashboardCard.module.css'

interface DashboardCardProps {
  issue: LinearIssueNode
  linkedWorkspace: Workspace | undefined
  isLinkedActive: boolean
  /** Click on the card / title — open linked workspace or the issue in Linear. */
  onActivate: (issue: LinearIssueNode) => void
  /** Rocket action — open a new worktree + coding agent for this issue. */
  onLaunchAgent: (issue: LinearIssueNode) => void
}

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
 * One issue rendered as a board card on the Dashboard kanban. The whole card is
 * a drag source (move between state columns); a 6px pointer-activation distance
 * on the column's DndContext keeps the title / rocket clickable. Linked-workspace
 * styling is driven via data attributes so the column can swap density cheaply.
 *
 * NOTE: the screenshot's diff stat (+N/−N), "View logs", and PR chip come from
 * the linked workspace / agent session, not from Linear. Those enrichments hang
 * off `linkedWorkspace` and are layered in once the workspace summary is wired
 * through; the base card stays correct for issues with no linked workspace.
 */
export function DashboardCard({
  issue,
  linkedWorkspace,
  isLinkedActive,
  onActivate,
  onLaunchAgent,
}: DashboardCardProps) {
  const dragId = `${ISSUE_DROPPABLE_PREFIX}${issue.id}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: 'issue', issue },
  })

  const linkState: 'active' | 'linked' | 'none' = isLinkedActive
    ? 'active'
    : linkedWorkspace
      ? 'linked'
      : 'none'

  // Tag shown top-left: prefer the linked workspace name (matches the codename
  // in the reference shots), else the project name, else the team key.
  const tag =
    linkedWorkspace?.name?.trim() ||
    issue.project?.name?.trim() ||
    issue.team?.key ||
    ''

  const assigneeInitials = initialsFor(issue.assignee?.name)
  const relative = formatRelative(issue.updatedAt ?? issue.createdAt)
  const snippet = issue.description?.trim() || ''

  return (
    <div
      ref={setNodeRef}
      className={styles.card}
      data-link-state={linkState}
      data-dragging={isDragging ? 'true' : 'false'}
      data-testid="linear-dashboard-card"
      {...attributes}
      {...listeners}
    >
      <div className={styles.head}>
        {tag ? (
          <span className={styles.tag} title={tag}>
            {tag}
          </span>
        ) : (
          <span />
        )}
        <span className={styles.stateCell}>
          <StateGlyph state={issue.state} variant="icon" size={14} />
        </span>
      </div>

      <button
        type="button"
        className={styles.title}
        onClick={() => onActivate(issue)}
        title={issue.title}
      >
        {issue.title}
      </button>

      {snippet ? <p className={styles.snippet}>{snippet}</p> : null}

      <div className={styles.foot}>
        <button
          type="button"
          className={styles.identifier}
          data-workspace-linked={linkedWorkspace ? 'true' : 'false'}
          onClick={(e) => {
            e.stopPropagation()
            onActivate(issue)
          }}
          title={
            linkedWorkspace
              ? `Open linked workspace: ${linkedWorkspace.name}`
              : `Open ${issue.identifier} in Linear`
          }
        >
          {issue.identifier}
        </button>
        <span className={styles.footSpacer} />
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
        <Tooltip label="New worktree and coding agent for this issue">
          <button
            type="button"
            className={styles.launchBtn}
            onClick={(e) => {
              e.stopPropagation()
              onLaunchAgent(issue)
            }}
            aria-label={`Open ${issue.identifier} in coding agent`}
          >
            <RocketLaunch size={13} aria-hidden weight="duotone" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
