import { describe, expect, it } from 'bun:test'
import {
  asFileChangeOutput,
  countPatchLineStats,
  diffStatsFromPatch,
  normalizePath,
  parseDiffRows,
  stripAnsi,
} from './diff-utils'

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

describe('parseDiffRows', () => {
  it('pairs a removed/added run into a modified row with intra-line highlight', () => {
    const { rows, additions, deletions } = parseDiffRows(EDIT_PATCH)
    expect(additions).toBe(1)
    expect(deletions).toBe(1)
    expect(rows.map((r) => r.type)).toEqual(['unchanged', 'modified', 'unchanged'])

    const modified = rows[1]
    expect(modified.left).toBe('const b = 2')
    expect(modified.right).toBe('const b = 3')
    expect(modified.leftNo).toBe(2)
    expect(modified.rightNo).toBe(2)
    // Only the differing token ("2"/"3") is highlighted.
    expect(modified.leftTokens?.some((t) => t.highlight && t.value.includes('2'))).toBe(true)
    expect(modified.rightTokens?.some((t) => t.highlight && t.value.includes('3'))).toBe(true)
  })

  it('reports pure additions and the no-newline marker', () => {
    const { rows, additions, deletions, hasNoNewline } = parseDiffRows(ADD_PATCH)
    expect(additions).toBe(2)
    expect(deletions).toBe(0)
    expect(rows.every((r) => r.type === 'added')).toBe(true)
    expect(hasNoNewline).toBe(true)
  })

  it('returns an empty model for an unparseable patch', () => {
    expect(parseDiffRows('not a patch').rows).toEqual([])
  })
})

describe('countPatchLineStats', () => {
  it('counts raw +/- lines when structured parse is empty', () => {
    expect(countPatchLineStats(EDIT_PATCH)).toEqual({ additions: 1, deletions: 1 })
    expect(diffStatsFromPatch(EDIT_PATCH)).toEqual({ additions: 1, deletions: 1 })
  })
})

describe('stripAnsi', () => {
  it('removes color escape codes', () => {
    expect(stripAnsi('[31mred[0m')).toBe('red')
  })
})

describe('normalizePath', () => {
  it('drops a leading ./ and prefers a shared/ root', () => {
    expect(normalizePath('./src/foo.ts')).toBe('src/foo.ts')
    expect(normalizePath('packages/app/src/shared/x.ts')).toBe('shared/x.ts')
  })
})

describe('asFileChangeOutput', () => {
  it('narrows the reconstructed diff payload', () => {
    expect(asFileChangeOutput({ kind: 'fileChange', files: [] })).not.toBeNull()
    expect(asFileChangeOutput({ kind: 'other' })).toBeNull()
    expect(asFileChangeOutput('nope')).toBeNull()
  })
})
