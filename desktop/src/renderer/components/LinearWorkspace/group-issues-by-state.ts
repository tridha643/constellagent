import type { LinearIssueNode } from '../../linear/linear-api'
import {
  LINEAR_ISSUE_STATE_TYPES,
  isLinearIssueStateType,
  type LinearIssueFilters,
  type LinearIssueStateType,
} from '../../store/types'
import { matchesFffQuery } from './fff-text-match'

export type IssueListRow = {
  issue: LinearIssueNode
  depth: 0 | 1
  isSubIssue: boolean
}

export interface IssueStateGroup {
  stateType: LinearIssueStateType
  label: string
  /** Flattened render list: parent rows followed by their in-bucket children. */
  rows: IssueListRow[]
  /** Convenience — same length as `rows`, kept so callers can show a "(N)" count. */
  issues: LinearIssueNode[]
}

export const LINEAR_ISSUE_STATE_LABELS: Record<LinearIssueStateType, string> = {
  started: 'In Progress',
  unstarted: 'Todo',
  backlog: 'Backlog',
  triage: 'Triage',
  completed: 'Done',
  canceled: 'Cancelled',
}

/**
 * Linear priority sort weight: 1 (Urgent) -> 0 (top), 2,3,4 next, then 0 ("no priority") / null last.
 * Lower returned number sorts earlier.
 */
function priorityWeight(p: number | undefined | null): number {
  if (p == null) return 99
  if (p === 1) return 0
  if (p === 2) return 1
  if (p === 3) return 2
  if (p === 4) return 3
  // 0 = "No priority" in Linear — show after numbered priorities but before null.
  return 4
}

function matchesFilters(
  issue: LinearIssueNode,
  filters: LinearIssueFilters,
): boolean {
  if (filters.priorities.length > 0) {
    const p = issue.priority
    if (p == null || !filters.priorities.includes(p)) return false
  }
  if (filters.stateTypes.length > 0) {
    const t = issue.state?.type?.toLowerCase()
    if (!t || !isLinearIssueStateType(t)) return false
    if (!filters.stateTypes.includes(t)) return false
  }
  if (filters.teamKeys.length > 0) {
    const key = issue.team?.key
    if (!key || !filters.teamKeys.includes(key)) return false
  }
  const q = filters.text.trim()
  if (q) {
    const hay = `${issue.identifier} ${issue.title}`
    if (!matchesFffQuery(hay, q)) return false
  }
  return true
}

function bucketFor(issue: LinearIssueNode): LinearIssueStateType | null {
  const raw = issue.state?.type?.toLowerCase()
  if (!raw) return null
  // Linear sometimes returns 'cancelled' spelling from older workflows; normalize.
  const normalized = raw === 'cancelled' ? 'canceled' : raw
  if (isLinearIssueStateType(normalized)) return normalized
  return null
}

function sortIssues(list: LinearIssueNode[]): LinearIssueNode[] {
  return [...list].sort((a, b) => {
    const dp = priorityWeight(a.priority) - priorityWeight(b.priority)
    if (dp !== 0) return dp
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return tb - ta
  })
}

/**
 * Pure grouping: apply filters, bucket by `state.type`, sort each bucket
 * by priority ascending then `updatedAt` descending, and emit a flat row list
 * with depth annotations so sub-issues render indented under their parent
 * within the same bucket. Sub-issues whose parent is filtered out or lives
 * in a different bucket render at depth 0 (never disappear).
 */
export function groupIssuesByState(
  issues: readonly LinearIssueNode[],
  filters: LinearIssueFilters,
): IssueStateGroup[] {
  const buckets = new Map<LinearIssueStateType, LinearIssueNode[]>()
  for (const st of LINEAR_ISSUE_STATE_TYPES) buckets.set(st, [])

  for (const issue of issues) {
    if (!matchesFilters(issue, filters)) continue
    const key = bucketFor(issue)
    if (!key) continue
    buckets.get(key)!.push(issue)
  }

  const out: IssueStateGroup[] = []
  for (const stateType of LINEAR_ISSUE_STATE_TYPES) {
    const bucketIssues = buckets.get(stateType)!
    if (bucketIssues.length === 0) continue

    const sorted = sortIssues(bucketIssues)
    const idsInBucket = new Set(sorted.map((i) => i.id))
    const parentToChildren = new Map<string, LinearIssueNode[]>()
    for (const i of sorted) {
      const pid = i.parent?.id
      if (pid && idsInBucket.has(pid)) {
        const arr = parentToChildren.get(pid) ?? []
        arr.push(i)
        parentToChildren.set(pid, arr)
      }
    }

    const rows: IssueListRow[] = []
    const emitted = new Set<string>()
    for (const issue of sorted) {
      if (emitted.has(issue.id)) continue
      const pid = issue.parent?.id
      const parentInBucket = pid ? idsInBucket.has(pid) : false
      if (parentInBucket) continue // emit only via the parent's walk
      rows.push({ issue, depth: 0, isSubIssue: false })
      emitted.add(issue.id)
      const kids = parentToChildren.get(issue.id)
      if (kids?.length) {
        for (const child of sortIssues(kids)) {
          if (emitted.has(child.id)) continue
          rows.push({ issue: child, depth: 1, isSubIssue: true })
          emitted.add(child.id)
        }
      }
    }

    out.push({
      stateType,
      label: LINEAR_ISSUE_STATE_LABELS[stateType],
      rows,
      issues: rows.map((r) => r.issue),
    })
  }
  return out
}
