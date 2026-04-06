import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseUnifiedDiff, validateRangeInDiff } from './index.ts'

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
