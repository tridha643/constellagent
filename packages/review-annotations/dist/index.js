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
`;
export async function ensureReviewAnnotationsSchema(db) {
    await db.executeMultiple(SCHEMA_SQL);
    // Migration: add branch column (nullable, safe to re-run)
    try {
        await db.execute('ALTER TABLE review_annotations ADD COLUMN branch TEXT');
    }
    catch {
        // Column already exists — ignore
    }
    await db.execute('CREATE INDEX IF NOT EXISTS idx_ra_branch ON review_annotations(branch)');
}
// ── DB open ──
export async function openAnnotationsDb(dbPath) {
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url: `file:${dbPath}` });
    await ensureReviewAnnotationsSchema(client);
    return client;
}
// ── Unified diff parser ──
const DIFF_FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/m;
const HUNK_HEADER = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
export function parseUnifiedDiff(diffText) {
    if (!diffText)
        return [];
    const results = [];
    const byPath = new Map();
    const segments = diffText.split(/^(?=diff --git )/m).filter(Boolean);
    for (const segment of segments) {
        const fileMatch = DIFF_FILE_HEADER.exec(segment);
        if (!fileMatch)
            continue;
        const filePath = fileMatch[2];
        let fileEntry = byPath.get(filePath);
        if (!fileEntry) {
            fileEntry = { filePath, hunks: [] };
            byPath.set(filePath, fileEntry);
            results.push(fileEntry);
        }
        let searchFrom = 0;
        while (true) {
            const hunkMatch = HUNK_HEADER.exec(segment.slice(searchFrom));
            if (!hunkMatch)
                break;
            fileEntry.hunks.push({
                oldStart: parseInt(hunkMatch[1], 10),
                oldCount: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
                newStart: parseInt(hunkMatch[3], 10),
                newCount: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
            });
            searchFrom += hunkMatch.index + hunkMatch[0].length;
        }
    }
    return results;
}
// ── Validation ──
export function validateRangeInDiff(parsedDiffs, filePath, side, lineStart, lineEnd) {
    const fileDiff = parsedDiffs.find((d) => d.filePath === filePath || d.filePath === filePath.replace(/^\//, ''));
    if (!fileDiff) {
        return { valid: false, error: `No diff found for file '${filePath}'` };
    }
    if (fileDiff.hunks.length === 0) {
        return { valid: false, error: `File '${filePath}' has no hunks in the diff` };
    }
    for (let i = 0; i < fileDiff.hunks.length; i++) {
        const h = fileDiff.hunks[i];
        const start = side === 'new' ? h.newStart : h.oldStart;
        const count = side === 'new' ? h.newCount : h.oldCount;
        if (count === 0)
            continue;
        const end = start + count - 1;
        if (lineStart >= start && lineEnd <= end) {
            return { valid: true, hunkIndex: i };
        }
    }
    return {
        valid: false,
        error: `Lines ${lineStart}-${lineEnd} (${side} side) not covered by any diff hunk in '${filePath}'`,
    };
}
// ── CRUD ──
function generateId() {
    return crypto.randomUUID();
}
function rowToAnnotation(row) {
    return {
        id: row.id,
        workspace_id: row.workspace_id ?? null,
        repo_root: row.repo_root,
        worktree_path: row.worktree_path ?? null,
        file_path: row.file_path,
        side: row.side,
        line_start: row.line_start,
        line_end: row.line_end,
        summary: row.summary,
        rationale: row.rationale ?? null,
        author: row.author ?? null,
        head_sha: row.head_sha ?? null,
        branch: row.branch ?? null,
        resolved: !!row.resolved,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
export async function addAnnotation(db, input, opts) {
    const side = input.side ?? 'new';
    const lineEnd = input.line_end ?? input.line_start;
    if (!opts?.force) {
        const diffText = opts?.diffText;
        if (!diffText) {
            throw new Error('diffText is required for validation (pass force: true to skip)');
        }
        const parsed = parseUnifiedDiff(diffText);
        const result = validateRangeInDiff(parsed, input.file_path, side, input.line_start, lineEnd);
        if (!result.valid) {
            throw new Error(result.error);
        }
    }
    const id = generateId();
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
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
    });
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
    };
}
export async function listAnnotations(db, filters) {
    const conditions = [];
    const args = [];
    if (filters?.workspace_id !== undefined) {
        conditions.push('workspace_id = ?');
        args.push(filters.workspace_id);
    }
    if (filters?.repo_root) {
        conditions.push('repo_root = ?');
        args.push(filters.repo_root);
    }
    if (filters?.file_path) {
        conditions.push('file_path = ?');
        args.push(filters.file_path);
    }
    if (filters?.branch) {
        conditions.push('branch = ?');
        args.push(filters.branch);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.execute({
        sql: `SELECT * FROM review_annotations${where} ORDER BY file_path, line_start`,
        args,
    });
    return result.rows.map((row) => rowToAnnotation(row));
}
export async function removeAnnotation(db, id) {
    await db.execute({ sql: 'DELETE FROM review_annotations WHERE id = ?', args: [id] });
}
export async function clearAnnotations(db, filters) {
    const conditions = [];
    const args = [];
    if (filters?.workspace_id !== undefined) {
        conditions.push('workspace_id = ?');
        args.push(filters.workspace_id);
    }
    if (filters?.repo_root) {
        conditions.push('repo_root = ?');
        args.push(filters.repo_root);
    }
    if (filters?.file_path) {
        conditions.push('file_path = ?');
        args.push(filters.file_path);
    }
    if (filters?.branch) {
        conditions.push('branch = ?');
        args.push(filters.branch);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    await db.execute({ sql: `DELETE FROM review_annotations${where}`, args });
}
export async function setResolved(db, id, resolved) {
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    await db.execute({
        sql: 'UPDATE review_annotations SET resolved = ?, updated_at = ? WHERE id = ?',
        args: [resolved ? 1 : 0, now, id],
    });
}
export function computeStaleFlags(annotations, diffText) {
    const parsed = parseUnifiedDiff(diffText);
    const result = new Map();
    for (const a of annotations) {
        const validation = validateRangeInDiff(parsed, a.file_path, a.side, a.line_start, a.line_end);
        result.set(a.id, !validation.valid);
    }
    return result;
}
