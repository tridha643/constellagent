/**
 * Unified fuzzy-jump index for the Linear workspace panel.
 * Cmd+F: fff (or subsequence fallback) picks candidates; we re-rank by newest max(createdAt, updatedAt),
 * then active before completed/canceled, then match score.
 */

import type { LinearProjectUpdateBarEntry } from '../store/types'
import { formatLinearProjectRowSubtitle, type LinearIssueNode, type LinearProjectNode } from './linear-api'
import {
  syntheticRelativePathForBar,
  syntheticRelativePathForIssue,
  syntheticRelativePathForProject,
} from './linear-synthetic-path'

export type LinearJumpKind =
  | 'issue'
  | 'project'
  | 'bar'

export interface LinearJumpRow {
  id: string
  kind: LinearJumpKind
  title: string
  subtitle: string
  /** Lowercased concatenation for subsequence match. */
  searchBlob: string
  /** Linear project id when this row is tied to a project (issue / bar / project). */
  projectId?: string
  assigneeId?: string
  creatorId?: string
  /** When set, Cmd+click / activate opens this URL (avoids stale lookups for API search hits). */
  navigateUrl?: string
  /**
   * Relative path under the fff synthetic index (`user/project/issue` layout for issues).
   * Used by native FileFinder quick open; optional for backwards compatibility.
   */
  fffRelativePath?: string
  /** Issue-only: epoch ms from Linear `createdAt` (Cmd+F sort uses max(created, updated)). */
  createdAtMs?: number
  /** Issue-only: epoch ms from Linear `updatedAt`. */
  updatedAtMs?: number
  /** Issue-only: Linear `WorkflowState.type` (e.g. started, completed). */
  issueStateType?: string
}

export const LINEAR_JUMP_RESULT_LIMIT = 50

/** Minimum query length before calling Linear search GraphQL from Quick Open. */
export const LINEAR_REMOTE_SEARCH_MIN_CHARS = 2

/** Build fff index entries from rows that have synthetic paths. */
export function linearJumpRowsToFffIndexEntries(
  rows: LinearJumpRow[],
): { relativePath: string; rowId: string }[] {
  const out: { relativePath: string; rowId: string }[] = []
  for (const r of rows) {
    if (r.fffRelativePath) {
      out.push({ relativePath: r.fffRelativePath, rowId: r.id })
    }
  }
  return out
}

/** Deterministic hash so main skips rewriting the synthetic tree when jump data is unchanged. */
export function linearFffIndexSyncHash(entries: { relativePath: string }[]): string {
  const s = entries
    .map((e) => e.relativePath)
    .sort()
    .join('\n')
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${(h >>> 0).toString(16)}:${entries.length}`
}

/** Stable per-API-key directory name for the main-process fff index. */
export function linearFffIndexKey(apiKey: string): string {
  const t = apiKey.trim()
  if (!t) return 'no-key'
  return linearFffIndexSyncHash([{ relativePath: `key:${t.slice(0, 48)}` }])
}

/** Separate index dir from Quick Open so picker and Cmd+F don’t share the same synthetic tree. */
export function linearProjectPickerFffIndexKey(apiKey: string): string {
  const t = apiKey.trim()
  if (!t) return 'no-key-picker'
  return linearFffIndexSyncHash([{ relativePath: `project-picker:${t.slice(0, 48)}` }])
}

/** Subsequence fuzzy match; returns matched char indices or null. */
export function fuzzyMatchSubsequence(query: string, target: string): number[] | null {
  const lowerQuery = query.trim().toLowerCase()
  if (!lowerQuery) return []

  const lowerTarget = target.toLowerCase()
  const indices: number[] = []
  let qi = 0

  for (let ti = 0; ti < lowerTarget.length && qi < lowerQuery.length; ti += 1) {
    if (lowerTarget[ti] === lowerQuery[qi]) {
      indices.push(ti)
      qi += 1
    }
  }

  return qi === lowerQuery.length ? indices : null
}

export function buildLinearJumpIndex(params: {
  barEntries: LinearProjectUpdateBarEntry[]
  projectNameById: Map<string, string>
  assigned: LinearIssueNode[]
  created: LinearIssueNode[]
  projects: LinearProjectNode[]
  /** Extra issues (e.g. GraphQL bulk fetch) merged in; deduped by issue id with assigned/created. */
  supplementalIssues?: LinearIssueNode[]
}): LinearJumpRow[] {
  const rows: LinearJumpRow[] = []
  const seenIssueIds = new Set<string>()

  for (const entry of params.barEntries) {
    const name =
      entry.labelOverride ||
      params.projectNameById.get(entry.linearProjectId) ||
      entry.linearProjectId.slice(0, 8)
    const note = entry.note ?? ''
    const rowId = `bar:${entry.linearProjectId}`
    rows.push({
      id: rowId,
      kind: 'bar',
      title: name,
      subtitle: 'Project update bar',
      searchBlob: `${name} ${note} ${entry.labelOverride ?? ''} bar update`.trim().toLowerCase(),
      projectId: entry.linearProjectId,
      fffRelativePath: syntheticRelativePathForBar({ projectName: name, rowId }),
    })
  }

  for (const issue of params.assigned) {
    seenIssueIds.add(issue.id)
    rows.push(issueRow(issue, 'Assigned'))
  }
  for (const issue of params.created) {
    if (seenIssueIds.has(issue.id)) continue
    rows.push(issueRow(issue, 'Created'))
  }

  for (const issue of params.supplementalIssues ?? []) {
    if (seenIssueIds.has(issue.id)) continue
    seenIssueIds.add(issue.id)
    rows.push(issueRow(issue, 'Project list'))
  }

  for (const p of params.projects) {
    const rowId = `project:${p.id}`
    const meta = formatLinearProjectRowSubtitle(p)
    rows.push({
      id: rowId,
      kind: 'project',
      title: p.name,
      subtitle: meta || 'Project',
      searchBlob: `${p.name} ${p.slugId} ${meta} project`.trim().toLowerCase(),
      projectId: p.id,
      navigateUrl: p.url || undefined,
      fffRelativePath: syntheticRelativePathForProject(p, rowId),
    })
  }

  return rows
}

function issueRow(issue: LinearIssueNode, role: string): LinearJumpRow {
  const team = issue.team ? `${issue.team.key} ${issue.team.name}` : ''
  const st = issue.state?.name ?? ''
  const proj = issue.project ? `${issue.project.name}` : ''
  const rowId = `issue:${issue.id}`
  const pu = issue.updatedAt ? Date.parse(issue.updatedAt) : NaN
  const updatedAtMs = Number.isFinite(pu) ? pu : undefined
  const pc = issue.createdAt ? Date.parse(issue.createdAt) : NaN
  const createdAtMs = Number.isFinite(pc) ? pc : undefined
  /** Prefer project on the issue when Linear returns it; otherwise show role (Assigned / Created / Search / …). */
  const displaySuffix = issue.project?.name?.trim() || role
  return {
    id: rowId,
    kind: 'issue',
    title: issue.title,
    subtitle: `Issue · ${issue.identifier} · ${displaySuffix}`,
    searchBlob:
      `${issue.identifier} ${issue.title} ${st} ${team} ${proj} ${role} issue`
        .trim()
        .toLowerCase(),
    projectId: issue.project?.id,
    assigneeId: issue.assignee?.id,
    creatorId: issue.creator?.id,
    navigateUrl: issue.url || undefined,
    fffRelativePath: syntheticRelativePathForIssue(issue, rowId),
    createdAtMs,
    updatedAtMs,
    issueStateType: issue.state?.type,
  }
}

/** Rows for issues returned from Linear search API (deduped with baseline by `issue:id`). */
export function linearJumpRowsFromSearchIssues(issues: LinearIssueNode[]): LinearJumpRow[] {
  return issues.map((issue) => issueRow(issue, 'Search'))
}

export function linearJumpRowsFromSearchProjects(projects: LinearProjectNode[]): LinearJumpRow[] {
  return projects.map((p) => {
    const rowId = `project:${p.id}`
    const meta = formatLinearProjectRowSubtitle(p)
    return {
      id: rowId,
      kind: 'project' as const,
      title: p.name,
      subtitle: meta || 'Project · Search',
      searchBlob: `${p.name} ${p.slugId} ${meta} project search`.trim().toLowerCase(),
      projectId: p.id,
      navigateUrl: p.url || undefined,
      fffRelativePath: syntheticRelativePathForProject(p, rowId),
    }
  })
}

/** Dedupe by row id: baseline first; API rows only add if id not seen. */
export function mergeLinearJumpRows(baseline: LinearJumpRow[], fromApi: LinearJumpRow[]): LinearJumpRow[] {
  const seen = new Set<string>()
  const out: LinearJumpRow[] = []
  for (const r of baseline) {
    seen.add(r.id)
    out.push(r)
  }
  for (const r of fromApi) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      out.push(r)
    }
  }
  return out
}

const DONE_STATE_MULT = 0.58

/** Newest of created/updated (ms); undefined for non-issues or issues with no dates. */
export function issueActivityMs(row: LinearJumpRow): number | undefined {
  if (row.kind !== 'issue') return undefined
  const parts: number[] = []
  if (row.createdAtMs !== undefined && Number.isFinite(row.createdAtMs)) parts.push(row.createdAtMs)
  if (row.updatedAtMs !== undefined && Number.isFinite(row.updatedAtMs)) parts.push(row.updatedAtMs)
  if (parts.length === 0) return undefined
  return Math.max(...parts)
}

/** Prefer backlog / in-progress over completed or canceled issues. */
export function activeMultiplierForJumpRow(row: LinearJumpRow): number {
  if (row.kind !== 'issue') return 1
  const t = (row.issueStateType ?? '').toLowerCase()
  if (t === 'completed' || t === 'canceled' || t === 'cancelled') return DONE_STATE_MULT
  return 1
}

/**
 * Cmd+F ordering after fff/fallback: **newest activity first** (max created/updated),
 * then **active before done**, then **relevance** (fff total or fuzzy goodness; higher = better).
 */
export function compareJumpRowsForQuickOpen(
  a: { row: LinearJumpRow; relevance: number },
  b: { row: LinearJumpRow; relevance: number },
): number {
  const ta = issueActivityMs(a.row)
  const tb = issueActivityMs(b.row)
  const hasA = ta !== undefined
  const hasB = tb !== undefined
  if (hasA && hasB && ta !== tb) return tb - ta
  if (hasA !== hasB) {
    if (hasA) return -1
    if (hasB) return 1
  }
  const actA = activeMultiplierForJumpRow(a.row)
  const actB = activeMultiplierForJumpRow(b.row)
  if (actB !== actA) return actB - actA
  const fa = Math.max(a.relevance, 1e-12)
  const fb = Math.max(b.relevance, 1e-12)
  if (fb !== fa) return fb - fa
  return a.row.title.localeCompare(b.row.title)
}

/**
 * Re-rank fff matches: time → active → fff score (see `compareJumpRowsForQuickOpen`).
 */
export function rankJumpRowsFromFffPaths(
  relativePaths: string[],
  scores: number[] | undefined,
  pathToRow: Map<string, LinearJumpRow>,
): LinearJumpRow[] {
  const norm = (p: string) => p.replace(/\\/g, '/')
  const items = relativePaths
    .map((p, i) => {
      const row = pathToRow.get(norm(p))
      if (!row) return null
      return { row, relevance: scores?.[i] ?? 0 }
    })
    .filter((x): x is { row: LinearJumpRow; relevance: number } => x !== null)

  items.sort((a, b) => compareJumpRowsForQuickOpen(a, b))
  return items.map((x) => x.row)
}

/** Narrow jump rows by project and/or person (assignee/creator on issues). */
export function applyLinearJumpScope(
  rows: LinearJumpRow[],
  scope: { projectId?: string | null; userId?: string | null },
): LinearJumpRow[] {
  const projectId = scope.projectId?.trim() || null
  const userId = scope.userId?.trim() || null

  if (!projectId && !userId) return rows

  return rows.filter((row) => {
    if (row.kind === 'issue') {
      const ip = row.projectId ?? null
      const matchProject = !projectId || ip === projectId
      const matchUser =
        !userId || row.assigneeId === userId || row.creatorId === userId
      return matchProject && matchUser
    }

    if (userId && !projectId) {
      return false
    }

    const rp = row.projectId ?? null
    if (!projectId) return false
    return rp === projectId
  })
}

export function filterAndSortJumpRows(
  rows: LinearJumpRow[],
  query: string,
  limit = LINEAR_JUMP_RESULT_LIMIT,
): LinearJumpRow[] {
  const q = query.trim()
  const cap = Math.max(1, Math.min(limit, 500))
  if (!q) {
    return rows.slice(0, cap)
  }

  const scored: { row: LinearJumpRow; score: number }[] = []
  for (const row of rows) {
    const m = fuzzyMatchSubsequence(q, row.searchBlob)
    if (m && m.length > 0) {
      scored.push({ row, score: m.reduce((a, b) => a + b, 0) })
    }
  }
  scored.sort((a, b) => {
    const relA = 1 / (1 + a.score)
    const relB = 1 / (1 + b.score)
    return compareJumpRowsForQuickOpen(
      { row: a.row, relevance: relA },
      { row: b.row, relevance: relB },
    )
  })
  return scored.slice(0, cap).map((s) => s.row)
}

/** Parse stable id after first ":" (Linear ids are opaque; avoid multi-split). */
export function linearJumpPayloadId(row: LinearJumpRow): string {
  const i = row.id.indexOf(':')
  return i >= 0 ? row.id.slice(i + 1) : row.id
}
