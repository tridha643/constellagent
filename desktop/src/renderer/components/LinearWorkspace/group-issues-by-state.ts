import type { LinearIssueNode } from '../../linear/linear-api'
import {
  LINEAR_ISSUE_STATE_TYPES,
  isLinearIssueStateType,
  type LinearIssueFilters,
  type LinearIssueStateType,
} from '../../store/types'
import { matchesFffQuery } from './fff-text-match'

export interface IssueStateGroup {
  stateType: LinearIssueStateType
  label: string
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

/**
 * Pure grouping: apply filters, bucket by `state.type`, sort each bucket
 * by priority ascending then `updatedAt` descending, and return non-empty
 * buckets in the canonical order defined by {@link LINEAR_ISSUE_STATE_TYPES}.
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
    const list = buckets.get(stateType)!
    if (list.length === 0) continue
    list.sort((a, b) => {
      const dp = priorityWeight(a.priority) - priorityWeight(b.priority)
      if (dp !== 0) return dp
      const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0
      const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0
      return tb - ta
    })
    out.push({
      stateType,
      label: LINEAR_ISSUE_STATE_LABELS[stateType],
      issues: list,
    })
  }
  return out
}
