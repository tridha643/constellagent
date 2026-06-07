import { describe, expect, it } from 'bun:test'
import {
  buildDiffPreviewModel,
  countPatchLineStats,
  diffStatsFromPatch,
  parseDiffRows,
} from './diff-model'

const EDIT_PATCH = `diff --git a/foo.ts b/foo.ts
index 1111111..2222222 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
 const c = 4
`

const ADD_PATCH = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const x = 1
+export const y = 2
\\ No newline at end of file
`

describe('diff preview model', () => {
  it('pairs modified lines and preserves stat counts', () => {
    const parsed = parseDiffRows(EDIT_PATCH)
    expect(parsed.rows.map((row) => row.type)).toEqual(['unchanged', 'modified', 'unchanged'])
    expect(parsed.additions).toBe(1)
    expect(parsed.deletions).toBe(1)
    expect(diffStatsFromPatch(EDIT_PATCH)).toEqual({ additions: 1, deletions: 1 })
  })

  it('captures no-newline patches', () => {
    const parsed = parseDiffRows(ADD_PATCH)
    expect(parsed.hasNoNewline).toBe(true)
    expect(parsed.additions).toBe(2)
    expect(parsed.deletions).toBe(0)
  })

  it('falls back to raw stats for invalid patches', () => {
    const patch = `not a structured patch
+added
-removed
`
    expect(countPatchLineStats(patch)).toEqual({ additions: 1, deletions: 1 })
    const model = buildDiffPreviewModel(patch, {
      path: 'broken.txt',
      status: 'modified',
      staged: false,
    })
    expect(model.parseError).toBe(true)
    expect(model.additions).toBe(1)
    expect(model.deletions).toBe(1)
  })
})
