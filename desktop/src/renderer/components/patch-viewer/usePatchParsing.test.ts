import { describe, expect, it } from 'bun:test'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { DiffFileData } from '../../types/working-tree-diff'
import { buildParseSnapshot, type ParseBudget } from './patch-parse-snapshot'
import { getPatchParseKey } from './patch-utils'

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
  } as DiffFileData
}

/** A stub parse that records calls and returns a recognizable metadata object. */
function makeStubParse() {
  const calls: string[] = []
  const parse = (patch: string, cacheKey: string): FileDiffMetadata | null => {
    calls.push(patch)
    return { cacheKey, hunks: [] } as unknown as FileDiffMetadata
  }
  return { parse, calls }
}

const UNLIMITED: ParseBudget = { maxFiles: Infinity, maxBytes: Infinity }

describe('buildParseSnapshot', () => {
  it('parses uncached files inline within budget and caches them', () => {
    const cache = new Map<string, FileDiffMetadata>()
    const { parse, calls } = makeStubParse()
    const files = [makeFile(1), makeFile(2)]

    const { snapshot, overflow } = buildParseSnapshot(files, cache, parse, UNLIMITED)

    expect(overflow).toHaveLength(0)
    expect(snapshot.size).toBe(2)
    expect(calls).toHaveLength(2)
    expect(cache.size).toBe(2)
    expect(snapshot.get(getPatchParseKey(files[0]!))).toBeDefined()
  })

  it('reuses cached metadata without re-parsing', () => {
    const cache = new Map<string, FileDiffMetadata>()
    const file = makeFile(1)
    cache.set(getPatchParseKey(file), { cacheKey: 'pre', hunks: [] } as unknown as FileDiffMetadata)
    const { parse, calls } = makeStubParse()

    const { snapshot, overflow } = buildParseSnapshot([file], cache, parse, UNLIMITED)

    expect(calls).toHaveLength(0)
    expect(overflow).toHaveLength(0)
    expect(snapshot.get(getPatchParseKey(file))?.cacheKey).toBe('pre')
  })

  it('routes work beyond the sync budget to overflow without parsing it', () => {
    const cache = new Map<string, FileDiffMetadata>()
    const { parse, calls } = makeStubParse()
    const files = [makeFile(1), makeFile(2), makeFile(3)]

    const { snapshot, overflow } = buildParseSnapshot(files, cache, parse, {
      maxFiles: 2,
      maxBytes: Infinity,
    })

    expect(calls).toHaveLength(2)
    expect(snapshot.size).toBe(2)
    expect(overflow).toHaveLength(1)
    expect(overflow[0]?.key).toBe(getPatchParseKey(files[2]!))
  })

  it('enforces the byte budget', () => {
    const cache = new Map<string, FileDiffMetadata>()
    const { parse } = makeStubParse()
    const big = makeFile(1, { patch: 'x'.repeat(100) })
    const next = makeFile(2)

    const { snapshot, overflow } = buildParseSnapshot([big, next], cache, parse, {
      maxFiles: Infinity,
      maxBytes: 50,
    })

    // First file consumes the byte budget (parsed); the second overflows.
    expect(snapshot.size).toBe(1)
    expect(overflow).toHaveLength(1)
    expect(overflow[0]?.key).toBe(getPatchParseKey(next))
  })

  it('skips combined-merge and empty patches', () => {
    const cache = new Map<string, FileDiffMetadata>()
    const { parse, calls } = makeStubParse()
    const files = [
      makeFile(1, { patch: '' }),
      makeFile(2, { patch: 'diff --cc src/file-2.ts\n@@@ -1,1 -1,1 +1,1 @@@\n' }),
      makeFile(3),
    ]

    const { snapshot, overflow } = buildParseSnapshot(files, cache, parse, UNLIMITED)

    expect(calls).toHaveLength(1) // only file 3
    expect(snapshot.size).toBe(1)
    expect(overflow).toHaveLength(0)
  })

  it('dedupes by content key', () => {
    const cache = new Map<string, FileDiffMetadata>()
    const { parse, calls } = makeStubParse()
    const file = makeFile(1)

    const { snapshot } = buildParseSnapshot([file, makeFile(1)], cache, parse, UNLIMITED)

    expect(calls).toHaveLength(1)
    expect(snapshot.size).toBe(1)
  })

  it('does not cache or surface a file whose parse returns null', () => {
    const cache = new Map<string, FileDiffMetadata>()
    const file = makeFile(1)
    const parse = () => null

    const { snapshot, overflow } = buildParseSnapshot([file], cache, parse, UNLIMITED)

    expect(snapshot.size).toBe(0)
    expect(cache.size).toBe(0)
    expect(overflow).toHaveLength(0)
  })
})
