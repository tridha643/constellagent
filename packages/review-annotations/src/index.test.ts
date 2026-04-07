import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import {
  addMemory,
  buildFtsMemoryQuery,
  type Client,
  listMemories,
  openAnnotationsDb,
  parseUnifiedDiff,
  removeMemory,
  searchMemories,
  validateRangeInDiff,
} from './index.ts'

async function withTempDb<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'review-annotations-'))
  const dbPath = join(dir, 'review-annotations.db')
  const db = await openAnnotationsDb(dbPath)

  try {
    return await run(db)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('parseUnifiedDiff', () => {
  it('parses a single-file diff with one hunk', () => {
    const diff = `diff --git a/foo.ts b/foo.ts
index 1234..5678 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 line1
 line2
+new line
 line3
`
    const result = parseUnifiedDiff(diff)
    assert.equal(result.length, 1)
    assert.equal(result[0].filePath, 'foo.ts')
    assert.equal(result[0].hunks.length, 1)
    assert.deepStrictEqual(result[0].hunks[0], {
      oldStart: 1, oldCount: 3, newStart: 1, newCount: 4,
    })
  })

  it('parses multi-file diff', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 a
+b
 c
diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -5,4 +5,6 @@
 line
+added1
+added2
 end
@@ -20,1 +22,1 @@
-old
+new
`
    const result = parseUnifiedDiff(diff)
    assert.equal(result.length, 2)
    assert.equal(result[0].filePath, 'a.ts')
    assert.equal(result[0].hunks.length, 1)
    assert.equal(result[1].filePath, 'x.ts')
    assert.equal(result[1].hunks.length, 2)
    assert.deepStrictEqual(result[1].hunks[0], {
      oldStart: 5, oldCount: 4, newStart: 5, newCount: 6,
    })
    assert.deepStrictEqual(result[1].hunks[1], {
      oldStart: 20, oldCount: 1, newStart: 22, newCount: 1,
    })
  })

  it('handles empty diff', () => {
    assert.deepStrictEqual(parseUnifiedDiff(''), [])
  })

  it('handles hunk with count omitted (defaults to 1)', () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -10 +10,2 @@
 line
+added
`
    const result = parseUnifiedDiff(diff)
    assert.equal(result[0].hunks[0].oldCount, 1)
    assert.equal(result[0].hunks[0].newCount, 2)
  })

  it('merges hunks when the same file appears in combined diffs', () => {
    const diff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,0 +1,1 @@
+branch line
diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -5,0 +6,1 @@
+worktree line
`
    const result = parseUnifiedDiff(diff)
    assert.equal(result.length, 1)
    assert.equal(result[0].filePath, 'foo.ts')
    assert.equal(result[0].hunks.length, 2)
    assert.deepStrictEqual(result[0].hunks[0], {
      oldStart: 1, oldCount: 0, newStart: 1, newCount: 1,
    })
    assert.deepStrictEqual(result[0].hunks[1], {
      oldStart: 5, oldCount: 0, newStart: 6, newCount: 1,
    })
  })
})

describe('validateRangeInDiff', () => {
  const diff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -5,10 +5,12 @@
 context
`
  const parsed = parseUnifiedDiff(diff)

  it('accepts a line within the new-side range', () => {
    const result = validateRangeInDiff(parsed, 'foo.ts', 'new', 5, 5)
    assert.equal(result.valid, true)
  })

  it('accepts a range within the new-side range', () => {
    const result = validateRangeInDiff(parsed, 'foo.ts', 'new', 5, 16)
    assert.equal(result.valid, true)
  })

  it('rejects a line outside any hunk', () => {
    const result = validateRangeInDiff(parsed, 'foo.ts', 'new', 100, 100)
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('not covered'))
  })

  it('rejects a non-existent file', () => {
    const result = validateRangeInDiff(parsed, 'bar.ts', 'new', 5, 5)
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('No diff found'))
  })

  it('validates old side correctly', () => {
    const result = validateRangeInDiff(parsed, 'foo.ts', 'old', 5, 14)
    assert.equal(result.valid, true)
  })

  it('rejects old-side line outside range', () => {
    const result = validateRangeInDiff(parsed, 'foo.ts', 'old', 5, 15)
    assert.equal(result.valid, false)
  })

  it('accepts a line from a later hunk for the same file in combined diffs', () => {
    const combined = parseUnifiedDiff(`diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,0 +1,1 @@
+branch line
diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,0 +11,1 @@
+worktree line
`)
    const result = validateRangeInDiff(combined, 'foo.ts', 'new', 11, 11)
    assert.equal(result.valid, true)
  })
})

describe('review memories', () => {
  it('creates the review_memories schema during bootstrap', async () => {
    await withTempDb(async (db) => {
      const result = await db.execute({
        sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        args: ['review_memories'],
      })

      assert.equal(result.rows.length, 1)
      assert.equal(result.rows[0].name, 'review_memories')
    })
  })

  it('adds and returns a stored memory row with an id', async () => {
    await withTempDb(async (db) => {
      const row = await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        worktree_path: '/repo-a',
        branch: 'feature-a',
        author: 'cursor',
        key: 'notes',
        summary: 'Remember the Graphite branch delta when listing review context.',
        details: 'This should stay repo-scoped for now.',
      })

      assert.match(row.id, /^[0-9a-f-]{36}$/)
      assert.equal(row.repo_root, '/repo-a')
      assert.equal(row.summary, 'Remember the Graphite branch delta when listing review context.')

      const stored = await listMemories(db, { repo_root: '/repo-a', key: 'notes' })
      assert.equal(stored.length, 1)
      assert.equal(stored[0].id, row.id)
    })
  })

  it('lists only rows for the requested repo by default', async () => {
    await withTempDb(async (db) => {
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        summary: 'Repo A memory',
      })
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-b',
        summary: 'Repo B memory',
      })

      const rows = await listMemories(db, { workspace_id: 'ws-1', repo_root: '/repo-a' })
      assert.equal(rows.length, 1)
      assert.equal(rows[0].summary, 'Repo A memory')
    })
  })

  it('filters by workspace_id exactly', async () => {
    await withTempDb(async (db) => {
      await addMemory(db, { workspace_id: 'ws-1', repo_root: '/repo-a', summary: 'ws-1 row' })
      await addMemory(db, { workspace_id: 'ws-2', repo_root: '/repo-a', summary: 'ws-2 row' })

      const rows = await listMemories(db, { workspace_id: 'ws-2', repo_root: '/repo-a' })
      assert.deepStrictEqual(rows.map((row) => row.summary), ['ws-2 row'])
    })
  })

  it('filters by branch exactly', async () => {
    await withTempDb(async (db) => {
      await addMemory(db, { workspace_id: 'ws-1', repo_root: '/repo-a', branch: 'feature-a', summary: 'feature-a row' })
      await addMemory(db, { workspace_id: 'ws-1', repo_root: '/repo-a', branch: 'feature-b', summary: 'feature-b row' })

      const rows = await listMemories(db, { workspace_id: 'ws-1', repo_root: '/repo-a', branch: 'feature-b' })
      assert.deepStrictEqual(rows.map((row) => row.summary), ['feature-b row'])
    })
  })

  it('filters by worktree_path exactly', async () => {
    await withTempDb(async (db) => {
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        worktree_path: '/repo-a/worktrees/one',
        summary: 'worktree one row',
      })
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        worktree_path: '/repo-a/worktrees/two',
        summary: 'worktree two row',
      })

      const rows = await listMemories(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        worktree_path: '/repo-a/worktrees/two',
      })
      assert.deepStrictEqual(rows.map((row) => row.summary), ['worktree two row'])
    })
  })

  it('filters by author exactly', async () => {
    await withTempDb(async (db) => {
      await addMemory(db, { workspace_id: 'ws-1', repo_root: '/repo-a', author: 'cursor', summary: 'cursor row' })
      await addMemory(db, { workspace_id: 'ws-1', repo_root: '/repo-a', author: 'codex', summary: 'codex row' })

      const rows = await listMemories(db, { workspace_id: 'ws-1', repo_root: '/repo-a', author: 'cursor' })
      assert.deepStrictEqual(rows.map((row) => row.summary), ['cursor row'])
    })
  })

  it('filters by key exactly', async () => {
    await withTempDb(async (db) => {
      await addMemory(db, { workspace_id: 'ws-1', repo_root: '/repo-a', key: 'routing', summary: 'routing row' })
      await addMemory(db, { workspace_id: 'ws-1', repo_root: '/repo-a', key: 'schema', summary: 'schema row' })

      const rows = await listMemories(db, { workspace_id: 'ws-1', repo_root: '/repo-a', key: 'schema' })
      assert.deepStrictEqual(rows.map((row) => row.summary), ['schema row'])
    })
  })

  it('combines filters with exact matches', async () => {
    await withTempDb(async (db) => {
      const matching = await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        worktree_path: '/repo-a/worktrees/current',
        branch: 'feature-a',
        author: 'cursor',
        key: 'schema',
        summary: 'matching row',
      })
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        worktree_path: '/repo-a/worktrees/current',
        branch: 'feature-a',
        author: 'cursor',
        key: 'routing',
        summary: 'wrong key row',
      })
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        worktree_path: '/repo-a/worktrees/other',
        branch: 'feature-a',
        author: 'cursor',
        key: 'schema',
        summary: 'wrong worktree row',
      })

      const rows = await listMemories(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        worktree_path: '/repo-a/worktrees/current',
        branch: 'feature-a',
        author: 'cursor',
        key: 'schema',
      })

      assert.equal(rows.length, 1)
      assert.equal(rows[0].id, matching.id)
    })
  })

  it('removes only the targeted row', async () => {
    await withTempDb(async (db) => {
      const keep = await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        summary: 'keep me',
      })
      const remove = await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        summary: 'remove me',
      })

      await removeMemory(db, remove.id)

      const rows = await listMemories(db, { workspace_id: 'ws-1', repo_root: '/repo-a' })
      assert.equal(rows.length, 1)
      assert.equal(rows[0].id, keep.id)
    })
  })
})

describe('buildFtsMemoryQuery', () => {
  it('prefixes simple tokens with AND', () => {
    assert.equal(buildFtsMemoryQuery('hello world'), 'hello* AND world*')
  })

  it('quotes tokens with special characters', () => {
    assert.equal(buildFtsMemoryQuery('foo@bar'), '"foo@bar"')
  })

  it('escapes double quotes inside tokens', () => {
    assert.equal(buildFtsMemoryQuery('say "hi"'), 'say* AND """hi"""')
  })

  it('rejects empty query', () => {
    assert.throws(() => buildFtsMemoryQuery('   '), /query is empty/)
  })
})

describe('searchMemories', () => {
  it('finds rows by token in summary, details, or key', async () => {
    await withTempDb(async (db) => {
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        key: 'routing',
        summary: 'Use the Graphite stack when rebasing feature branches.',
        details: 'Parent branch matters for CI.',
      })

      const found = await searchMemories(db, {
        query: 'Graphite',
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
      })
      assert.equal(found.length, 1)
      assert.match(found[0].summary, /Graphite/)

      const byDetail = await searchMemories(db, {
        query: 'matters',
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
      })
      assert.equal(byDetail.length, 1)

      const byKey = await searchMemories(db, {
        query: 'routing',
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
      })
      assert.equal(byKey.length, 1)
    })
  })

  it('applies exact scope filters with FTS', async () => {
    await withTempDb(async (db) => {
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        author: 'cursor',
        summary: 'Shared token alpha for both rows',
      })
      await addMemory(db, {
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        author: 'codex',
        summary: 'Shared token alpha for both rows',
      })

      const both = await searchMemories(db, {
        query: 'alpha',
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
      })
      assert.equal(both.length, 2)

      const one = await searchMemories(db, {
        query: 'alpha',
        workspace_id: 'ws-1',
        repo_root: '/repo-a',
        author: 'cursor',
      })
      assert.equal(one.length, 1)
      assert.equal(one[0].author, 'cursor')
    })
  })

  it('backfills FTS when opening a DB that only had review_memories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-annotations-'))
    const dbPath = join(dir, 'review-annotations.db')

    const raw = createClient({ url: `file:${dbPath}` })
    await raw.executeMultiple(`
CREATE TABLE review_memories (
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
INSERT INTO review_memories (id, workspace_id, repo_root, summary, created_at, updated_at)
VALUES ('legacy-id', 'ws-1', '/legacy', 'legacy row mentions unicorns', '2020-01-01 00:00:00', '2020-01-01 00:00:00');
`)
    raw.close()

    const db = await openAnnotationsDb(dbPath)
    try {
      const found = await searchMemories(db, {
        query: 'unicorns',
        workspace_id: 'ws-1',
        repo_root: '/legacy',
      })
      assert.equal(found.length, 1)
      assert.equal(found[0].id, 'legacy-id')
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects empty query', async () => {
    await withTempDb(async (db) => {
      await assert.rejects(
        () =>
          searchMemories(db, {
            query: '  ',
            workspace_id: 'ws-1',
            repo_root: '/repo-a',
          }),
        /query is required/,
      )
    })
  })
})
