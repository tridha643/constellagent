import { describe, expect, it } from 'bun:test'
import type { DiffFileData } from '../../types/working-tree-diff'
import { getDiffFileChangeStats, getDiffFileReviewLineCount, getDiffReviewSummary } from './diff-stats'

function makeFile(index: number, overrides: Partial<DiffFileData> = {}): DiffFileData {
  return {
    filePath: `src/file-${index}.ts`,
    patch: `diff --git a/src/file-${index}.ts b/src/file-${index}.ts
--- a/src/file-${index}.ts
+++ b/src/file-${index}.ts
@@ -1 +1 @@
-old
+new
`,
    status: 'modified',
    staged: false,
    ...overrides,
  }
}

describe('diff-stats', () => {
  it('prefers status metadata for summary counts instead of parsing patches', () => {
    const files = [
      makeFile(1, {
        additions: 8,
        deletions: 3,
        patch: `not a structured patch
+would be one parsed addition
-would be one parsed deletion
`,
      }),
      makeFile(2, { additions: 0, deletions: 4, staged: true, patch: '' }),
    ]

    expect(getDiffFileChangeStats(files[0]!)).toEqual({ additions: 8, deletions: 3 })
    expect(getDiffReviewSummary(files)).toEqual({
      additions: 8,
      deletions: 7,
      staged: 1,
      unstaged: 1,
    })
  })

  it('counts review lines from status metadata when present, else falls back to patch lines', () => {
    expect(getDiffFileReviewLineCount(makeFile(1, { additions: 3, deletions: 2 }))).toBe(5)
    expect(getDiffFileReviewLineCount(makeFile(2, { additions: undefined, deletions: undefined }))).toBeGreaterThan(0)
    expect(getDiffFileReviewLineCount(makeFile(3, { additions: undefined, deletions: undefined, patch: '' }))).toBe(0)
  })
})
