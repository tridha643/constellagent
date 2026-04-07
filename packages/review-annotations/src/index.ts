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
  branch: string | null
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
  branch?: string | null
}

export interface ReviewMemory {
  id: string
  workspace_id: string | null
  repo_root: string
  worktree_path: string | null
  branch: string | null
  author: string | null
  key: string | null
  summary: string
  details: string | null
  created_at: string
  updated_at: string
}

export interface AddMemoryInput {
  workspace_id?: string | null
  repo_root: string
  worktree_path?: string | null
  branch?: string | null
  author?: string | null
  key?: string | null
  summary: string
  details?: string | null
}

export interface ListAnnotationFilters {
  workspace_id?: string | null
  repo_root?: string
  file_path?: string
  branch?: string
}

export interface ListMemoryFilters {
  workspace_id?: string | null
  repo_root?: string
  worktree_path?: string | null
  branch?: string | null
  author?: string | null
  key?: string | null
}

/** Scope filters match {@link ListMemoryFilters}; `query` is full-text search over summary, details, and key. */
export interface SearchMemoryFilters extends ListMemoryFilters {
  query: string
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

CREATE TABLE IF NOT EXISTS review_memories (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT,
  repo_root     TEXT NOT NULL,
  worktree_path TEXT,
  branch        TEXT,
  author        TEXT,
  key           TEXT,
  summary       TEXT NOT NULL,
  details       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rm_ws_repo      ON review_memories(workspace_id, repo_root);
CREATE INDEX IF NOT EXISTS idx_rm_repo_branch  ON review_memories(repo_root, branch);
CREATE INDEX IF NOT EXISTS idx_rm_repo_worktree ON review_memories(repo_root, worktree_path);
CREATE INDEX IF NOT EXISTS idx_rm_repo_author  ON review_memories(repo_root, author);
CREATE INDEX IF NOT EXISTS idx_rm_repo_key     ON review_memories(repo_root, key);
`

export async function ensureReviewAnnotationsSchema(db: Client): Promise<void> {
  await db.executeMultiple(SCHEMA_SQL)
  // Migration: add branch column (nullable, safe to re-run)
  try {
    await db.execute('ALTER TABLE review_annotations ADD COLUMN branch TEXT')
  } catch {
    // Column already exists — ignore
  }
  await db.execute('CREATE INDEX IF NOT EXISTS idx_ra_branch ON review_annotations(branch)')
  await ensureReviewMemoriesFts(db)
}

const MEMORIES_FTS_TABLE = 'review_memories_fts'

/** Build an FTS5 MATCH string: whitespace-split tokens joined with AND; simple tokens use prefix `term*`, others are quoted. */
export function buildFtsMemoryQuery(userQuery: string): string {
  const trimmed = userQuery.trim()
  if (!trimmed) {
    throw new Error('query is empty')
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  const parts = tokens.map((token) => {
    const escaped = token.replace(/"/g, '""')
    if (/^[\p{L}\p{N}_-]+$/u.test(token)) {
      return `${escaped}*`
    }
    return `"${escaped}"`
  })
  return parts.join(' AND ')
}

/** Escape `%`, `_`, and `\` for use inside a LIKE pattern with `ESCAPE '\\'`. */
export function escapeLikeFragmentForEscapeClause(fragment: string): string {
  return fragment.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

async function ensureReviewMemoriesFts(db: Client): Promise<void> {
  try {
    await db.execute({
      sql: `CREATE VIRTUAL TABLE IF NOT EXISTS ${MEMORIES_FTS_TABLE} USING fts5(
        summary,
        details,
        key,
        content='review_memories',
        content_rowid='rowid'
      )`,
    })

    await db.executeMultiple(`
CREATE TRIGGER IF NOT EXISTS review_memories_ai AFTER INSERT ON review_memories BEGIN
  INSERT INTO ${MEMORIES_FTS_TABLE}(rowid, summary, details, key)
  VALUES (new.rowid, new.summary, new.details, new.key);
END;
CREATE TRIGGER IF NOT EXISTS review_memories_ad AFTER DELETE ON review_memories BEGIN
  INSERT INTO ${MEMORIES_FTS_TABLE}(${MEMORIES_FTS_TABLE}, rowid) VALUES('delete', old.rowid);
END;
CREATE TRIGGER IF NOT EXISTS review_memories_au AFTER UPDATE ON review_memories BEGIN
  INSERT INTO ${MEMORIES_FTS_TABLE}(${MEMORIES_FTS_TABLE}, rowid) VALUES('delete', old.rowid);
  INSERT INTO ${MEMORIES_FTS_TABLE}(rowid, summary, details, key)
  VALUES (new.rowid, new.summary, new.details, new.key);
END;
`)

    const counts = await db.execute({
      sql: `SELECT
        (SELECT COUNT(*) FROM review_memories) AS mc,
        (SELECT COUNT(*) FROM ${MEMORIES_FTS_TABLE}) AS fc`,
    })
    const row = counts.rows[0] as unknown as { mc: number; fc: number }
    const mc = Number(row.mc)
    const fc = Number(row.fc)
    if (mc > fc) {
      await db.execute({
        sql: `INSERT INTO ${MEMORIES_FTS_TABLE}(${MEMORIES_FTS_TABLE}) VALUES('rebuild')`,
      })
    }
  } catch {
    // FTS5 unavailable or migration failed — searchMemories falls back to LIKE.
  }
}

async function memoriesFtsAvailable(db: Client): Promise<boolean> {
  const r = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    args: [MEMORIES_FTS_TABLE],
  })
  return r.rows.length > 0
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
  const byPath = new Map<string, ParsedFileDiff>()
  const segments = diffText.split(/^(?=diff --git )/m).filter(Boolean)

  for (const segment of segments) {
    const fileMatch = DIFF_FILE_HEADER.exec(segment)
    if (!fileMatch) continue

    const filePath = fileMatch[2]
    let fileEntry = byPath.get(filePath)
    if (!fileEntry) {
      fileEntry = { filePath, hunks: [] }
      byPath.set(filePath, fileEntry)
      results.push(fileEntry)
    }
    let searchFrom = 0

    while (true) {
      const hunkMatch = HUNK_HEADER.exec(segment.slice(searchFrom))
      if (!hunkMatch) break
      fileEntry.hunks.push({
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
      })
      searchFrom += hunkMatch.index! + hunkMatch[0].length
    }
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

type SqlArg = string | number | null

function appendExactMatchCondition(
  conditions: string[],
  args: SqlArg[],
  column: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return
  if (value === null) {
    conditions.push(`${column} IS NULL`)
    return
  }

  conditions.push(`${column} = ?`)
  args.push(value)
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
    branch: (row.branch as string) ?? null,
    resolved: !!(row.resolved as number),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

function rowToMemory(row: Record<string, unknown>): ReviewMemory {
  return {
    id: row.id as string,
    workspace_id: (row.workspace_id as string) ?? null,
    repo_root: row.repo_root as string,
    worktree_path: (row.worktree_path as string) ?? null,
    branch: (row.branch as string) ?? null,
    author: (row.author as string) ?? null,
    key: (row.key as string) ?? null,
    summary: row.summary as string,
    details: (row.details as string) ?? null,
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
       summary, rationale, author, head_sha, branch, resolved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
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
      input.branch ?? null,
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
    branch: input.branch ?? null,
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
  const args: SqlArg[] = []

  appendExactMatchCondition(conditions, args, 'workspace_id', filters?.workspace_id)
  appendExactMatchCondition(conditions, args, 'repo_root', filters?.repo_root)
  appendExactMatchCondition(conditions, args, 'file_path', filters?.file_path)
  appendExactMatchCondition(conditions, args, 'branch', filters?.branch)

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
  const args: SqlArg[] = []

  appendExactMatchCondition(conditions, args, 'workspace_id', filters?.workspace_id)
  appendExactMatchCondition(conditions, args, 'repo_root', filters?.repo_root)
  appendExactMatchCondition(conditions, args, 'file_path', filters?.file_path)
  appendExactMatchCondition(conditions, args, 'branch', filters?.branch)

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  await db.execute({ sql: `DELETE FROM review_annotations${where}`, args })
}

export async function addMemory(db: Client, input: AddMemoryInput): Promise<ReviewMemory> {
  const id = generateId()
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '')

  await db.execute({
    sql: `INSERT INTO review_memories
      (id, workspace_id, repo_root, worktree_path, branch, author, key, summary, details, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.workspace_id ?? null,
      input.repo_root,
      input.worktree_path ?? null,
      input.branch ?? null,
      input.author ?? null,
      input.key ?? null,
      input.summary,
      input.details ?? null,
      now,
      now,
    ],
  })

  return {
    id,
    workspace_id: input.workspace_id ?? null,
    repo_root: input.repo_root,
    worktree_path: input.worktree_path ?? null,
    branch: input.branch ?? null,
    author: input.author ?? null,
    key: input.key ?? null,
    summary: input.summary,
    details: input.details ?? null,
    created_at: now,
    updated_at: now,
  }
}

export async function listMemories(
  db: Client,
  filters?: ListMemoryFilters,
): Promise<ReviewMemory[]> {
  const conditions: string[] = []
  const args: SqlArg[] = []

  appendExactMatchCondition(conditions, args, 'workspace_id', filters?.workspace_id)
  appendExactMatchCondition(conditions, args, 'repo_root', filters?.repo_root)
  appendExactMatchCondition(conditions, args, 'worktree_path', filters?.worktree_path)
  appendExactMatchCondition(conditions, args, 'branch', filters?.branch)
  appendExactMatchCondition(conditions, args, 'author', filters?.author)
  appendExactMatchCondition(conditions, args, 'key', filters?.key)

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const result = await db.execute({
    sql: `SELECT * FROM review_memories${where} ORDER BY created_at DESC, id`,
    args,
  })

  return result.rows.map((row) => rowToMemory(row as unknown as Record<string, unknown>))
}

export async function searchMemories(
  db: Client,
  filters: SearchMemoryFilters,
): Promise<ReviewMemory[]> {
  const q = filters.query.trim()
  if (!q) {
    throw new Error('query is required')
  }

  if (await memoriesFtsAvailable(db)) {
    try {
      const matchExpr = buildFtsMemoryQuery(q)
      const ftsRows = await searchMemoriesFts(db, filters, matchExpr)
      if (ftsRows.length > 0) {
        return ftsRows
      }
    } catch {
      // MATCH or bm25 unsupported in this SQLite build — use LIKE below.
    }
  }
  return searchMemoriesLike(db, filters, q)
}

async function searchMemoriesFts(
  db: Client,
  filters: SearchMemoryFilters,
  matchExpr: string,
): Promise<ReviewMemory[]> {
  const conditions: string[] = []
  const args: SqlArg[] = []

  conditions.push(`${MEMORIES_FTS_TABLE} MATCH ?`)
  args.push(matchExpr)

  appendExactMatchCondition(conditions, args, 'm.workspace_id', filters.workspace_id)
  appendExactMatchCondition(conditions, args, 'm.repo_root', filters.repo_root)
  appendExactMatchCondition(conditions, args, 'm.worktree_path', filters.worktree_path)
  appendExactMatchCondition(conditions, args, 'm.branch', filters.branch)
  appendExactMatchCondition(conditions, args, 'm.author', filters.author)
  appendExactMatchCondition(conditions, args, 'm.key', filters.key)

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

  const sqlBm25 = `SELECT m.* FROM review_memories m
    INNER JOIN ${MEMORIES_FTS_TABLE} fts ON fts.rowid = m.rowid
    ${where}
    ORDER BY bm25(${MEMORIES_FTS_TABLE}), m.created_at DESC, m.id`

  try {
    const result = await db.execute({ sql: sqlBm25, args })
    return result.rows.map((row) => rowToMemory(row as unknown as Record<string, unknown>))
  } catch {
    const sqlFallback = `SELECT m.* FROM review_memories m
      INNER JOIN ${MEMORIES_FTS_TABLE} fts ON fts.rowid = m.rowid
      ${where}
      ORDER BY m.created_at DESC, m.id`
    const result = await db.execute({ sql: sqlFallback, args })
    return result.rows.map((row) => rowToMemory(row as unknown as Record<string, unknown>))
  }
}

async function searchMemoriesLike(
  db: Client,
  filters: SearchMemoryFilters,
  rawQuery: string,
): Promise<ReviewMemory[]> {
  const tokens = rawQuery.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    throw new Error('query is required')
  }

  const conditions: string[] = []
  const args: SqlArg[] = []

  const likeGroup =
    `(m.summary LIKE ? ESCAPE '\\' OR IFNULL(m.details, '') LIKE ? ESCAPE '\\' OR IFNULL(m.key, '') LIKE ? ESCAPE '\\')`
  for (const token of tokens) {
    const esc = escapeLikeFragmentForEscapeClause(token)
    const pattern = `%${esc}%`
    conditions.push(likeGroup)
    args.push(pattern, pattern, pattern)
  }

  appendExactMatchCondition(conditions, args, 'm.workspace_id', filters.workspace_id)
  appendExactMatchCondition(conditions, args, 'm.repo_root', filters.repo_root)
  appendExactMatchCondition(conditions, args, 'm.worktree_path', filters.worktree_path)
  appendExactMatchCondition(conditions, args, 'm.branch', filters.branch)
  appendExactMatchCondition(conditions, args, 'm.author', filters.author)
  appendExactMatchCondition(conditions, args, 'm.key', filters.key)

  const where = ` WHERE ${conditions.join(' AND ')}`
  const result = await db.execute({
    sql: `SELECT m.* FROM review_memories m${where} ORDER BY m.created_at DESC, m.id`,
    args,
  })

  return result.rows.map((row) => rowToMemory(row as unknown as Record<string, unknown>))
}

export async function removeMemory(db: Client, id: string): Promise<void> {
  await db.execute({ sql: 'DELETE FROM review_memories WHERE id = ?', args: [id] })
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
