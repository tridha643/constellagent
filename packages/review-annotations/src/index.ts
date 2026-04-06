import type { Client, InStatement } from '@libsql/client'
export type { Client } from '@libsql/client'

// ── Types ──

export interface ReviewAnnotation {
  id: string
  workspace_id: string | null
  repo_root: string
  worktree_path: string | null
  file_path: string
  side: 'new' | 'old'
  line_start: number
  line_end: number
  summary: string
  rationale: string | null
  author: string | null
  head_sha: string | null
  resolved: boolean
  created_at: string
  updated_at: string
}

export interface HunkRange {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

export interface ParsedFileDiff {
  filePath: string
  hunks: HunkRange[]
}

export interface ValidationResult {
  valid: boolean
  hunkIndex?: number
  error?: string
}

export interface AddAnnotationInput {
  workspace_id?: string | null
  repo_root: string
  worktree_path?: string | null
  file_path: string
  side?: 'new' | 'old'
  line_start: number
  line_end?: number
  summary: string
  rationale?: string | null
  author?: string | null
  head_sha?: string | null
}

export interface ListAnnotationFilters {
  workspace_id?: string | null
  repo_root?: string
  file_path?: string
}

// ── Schema ──

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS review_annotations (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT,
  repo_root     TEXT NOT NULL,
  worktree_path TEXT,
  file_path     TEXT NOT NULL,
  side          TEXT NOT NULL DEFAULT 'new',
  line_start    INTEGER NOT NULL,
  line_end      INTEGER NOT NULL,
  summary       TEXT NOT NULL,
  rationale     TEXT,
  author        TEXT,
  head_sha      TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ra_ws_repo ON review_annotations(workspace_id, repo_root);
CREATE INDEX IF NOT EXISTS idx_ra_ws_file ON review_annotations(workspace_id, file_path);
CREATE INDEX IF NOT EXISTS idx_ra_repo    ON review_annotations(repo_root);
`

export async function ensureReviewAnnotationsSchema(db: Client): Promise<void> {
  await db.executeMultiple(SCHEMA_SQL)
}

// ── DB open ──

export async function openAnnotationsDb(dbPath: string): Promise<Client> {
  const { createClient } = await import('@libsql/client')
  const client = createClient({ url: `file:${dbPath}` })
  await ensureReviewAnnotationsSchema(client)
  return client
}

// ── Unified diff parser ──

const DIFF_FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/m
const HUNK_HEADER = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseUnifiedDiff(diffText: string): ParsedFileDiff[] {
  if (!diffText) return []
  const results: ParsedFileDiff[] = []
  const segments = diffText.split(/^(?=diff --git )/m).filter(Boolean)

  for (const segment of segments) {
    const fileMatch = DIFF_FILE_HEADER.exec(segment)
    if (!fileMatch) continue

    const filePath = fileMatch[2]
    const hunks: HunkRange[] = []
    let searchFrom = 0

    while (true) {
      const hunkMatch = HUNK_HEADER.exec(segment.slice(searchFrom))
      if (!hunkMatch) break
      hunks.push({
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
      })
      searchFrom += hunkMatch.index! + hunkMatch[0].length
    }

    results.push({ filePath, hunks })
  }

  return results
}

// ── Validation ──

export function validateRangeInDiff(
  parsedDiffs: ParsedFileDiff[],
  filePath: string,
  side: 'new' | 'old',
  lineStart: number,
  lineEnd: number,
): ValidationResult {
  const fileDiff = parsedDiffs.find(
    (d) => d.filePath === filePath || d.filePath === filePath.replace(/^\//, ''),
  )
  if (!fileDiff) {
    return { valid: false, error: `No diff found for file '${filePath}'` }
  }
  if (fileDiff.hunks.length === 0) {
    return { valid: false, error: `File '${filePath}' has no hunks in the diff` }
  }

  for (let i = 0; i < fileDiff.hunks.length; i++) {
    const h = fileDiff.hunks[i]
    const start = side === 'new' ? h.newStart : h.oldStart
    const count = side === 'new' ? h.newCount : h.oldCount
    if (count === 0) continue
    const end = start + count - 1
    if (lineStart >= start && lineEnd <= end) {
      return { valid: true, hunkIndex: i }
    }
  }

  return {
    valid: false,
    error: `Lines ${lineStart}-${lineEnd} (${side} side) not covered by any diff hunk in '${filePath}'`,
  }
}

// ── CRUD ──

function generateId(): string {
  return crypto.randomUUID()
}

function rowToAnnotation(row: Record<string, unknown>): ReviewAnnotation {
  return {
    id: row.id as string,
    workspace_id: (row.workspace_id as string) ?? null,
    repo_root: row.repo_root as string,
    worktree_path: (row.worktree_path as string) ?? null,
    file_path: row.file_path as string,
    side: row.side as 'new' | 'old',
    line_start: row.line_start as number,
    line_end: row.line_end as number,
    summary: row.summary as string,
    rationale: (row.rationale as string) ?? null,
    author: (row.author as string) ?? null,
    head_sha: (row.head_sha as string) ?? null,
    resolved: !!(row.resolved as number),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export async function addAnnotation(
  db: Client,
  input: AddAnnotationInput,
  opts?: { force?: boolean; diffText?: string },
): Promise<ReviewAnnotation> {
  const side = input.side ?? 'new'
  const lineEnd = input.line_end ?? input.line_start

  if (!opts?.force) {
    const diffText = opts?.diffText
    if (!diffText) {
      throw new Error('diffText is required for validation (pass force: true to skip)')
    }
    const parsed = parseUnifiedDiff(diffText)
    const result = validateRangeInDiff(parsed, input.file_path, side, input.line_start, lineEnd)
    if (!result.valid) {
      throw new Error(result.error)
    }
  }

  const id = generateId()
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '')

  await db.execute({
    sql: `INSERT INTO review_annotations
      (id, workspace_id, repo_root, worktree_path, file_path, side, line_start, line_end,
       summary, rationale, author, head_sha, resolved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    args: [
      id,
      input.workspace_id ?? null,
      input.repo_root,
      input.worktree_path ?? null,
      input.file_path,
      side,
      input.line_start,
      lineEnd,
      input.summary,
      input.rationale ?? null,
      input.author ?? null,
      input.head_sha ?? null,
      now,
      now,
    ],
  })

  return {
    id,
    workspace_id: input.workspace_id ?? null,
    repo_root: input.repo_root,
    worktree_path: input.worktree_path ?? null,
    file_path: input.file_path,
    side,
    line_start: input.line_start,
    line_end: lineEnd,
    summary: input.summary,
    rationale: input.rationale ?? null,
    author: input.author ?? null,
    head_sha: input.head_sha ?? null,
    resolved: false,
    created_at: now,
    updated_at: now,
  }
}

export async function listAnnotations(
  db: Client,
  filters?: ListAnnotationFilters,
): Promise<ReviewAnnotation[]> {
  const conditions: string[] = []
  const args: (string | null)[] = []

  if (filters?.workspace_id !== undefined) {
    conditions.push('workspace_id = ?')
    args.push(filters.workspace_id)
  }
  if (filters?.repo_root) {
    conditions.push('repo_root = ?')
    args.push(filters.repo_root)
  }
  if (filters?.file_path) {
    conditions.push('file_path = ?')
    args.push(filters.file_path)
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const result = await db.execute({
    sql: `SELECT * FROM review_annotations${where} ORDER BY file_path, line_start`,
    args,
  })

  return result.rows.map((row) => rowToAnnotation(row as unknown as Record<string, unknown>))
}

export async function removeAnnotation(db: Client, id: string): Promise<void> {
  await db.execute({ sql: 'DELETE FROM review_annotations WHERE id = ?', args: [id] })
}

export async function clearAnnotations(db: Client, filters?: ListAnnotationFilters): Promise<void> {
  const conditions: string[] = []
  const args: (string | null)[] = []

  if (filters?.workspace_id !== undefined) {
    conditions.push('workspace_id = ?')
    args.push(filters.workspace_id)
  }
  if (filters?.repo_root) {
    conditions.push('repo_root = ?')
    args.push(filters.repo_root)
  }
  if (filters?.file_path) {
    conditions.push('file_path = ?')
    args.push(filters.file_path)
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  await db.execute({ sql: `DELETE FROM review_annotations${where}`, args })
}

export async function setResolved(db: Client, id: string, resolved: boolean): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '')
  await db.execute({
    sql: 'UPDATE review_annotations SET resolved = ?, updated_at = ? WHERE id = ?',
    args: [resolved ? 1 : 0, now, id],
  })
}

export function computeStaleFlags(
  annotations: ReviewAnnotation[],
  diffText: string,
): Map<string, boolean> {
  const parsed = parseUnifiedDiff(diffText)
  const result = new Map<string, boolean>()

  for (const a of annotations) {
    const validation = validateRangeInDiff(parsed, a.file_path, a.side, a.line_start, a.line_end)
    result.set(a.id, !validation.valid)
  }

  return result
}
