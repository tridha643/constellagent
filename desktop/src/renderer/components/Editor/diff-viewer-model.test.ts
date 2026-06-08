import { describe, expect, it } from 'bun:test'
import type { DiffFileData } from '../../types/working-tree-diff'
import {
  buildDiffFileVirtualLayout,
  buildDiffLayoutAnchorKey,
  captureDiffScrollAnchor,
  clampDiffScrollTop,
  collectIntersectingFileSectionIds,
  estimateDiffFileHeight,
  findHeaderOwningFileSection,
  getDiffFileChangeStats,
  getDiffReviewSummary,
  ensureFileInVirtualWindow,
  getScrollTopForFileHeader,
  getVirtualDiffFileWindow,
  getVisibleDiffFiles,
  restoreDiffScrollTop,
} from './diff-viewer-model'

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

describe('diff viewer model', () => {
  it('windows working-tree files but keeps commit diffs complete', () => {
    const files = Array.from({ length: 40 }, (_, index) => makeFile(index))

    expect(getVisibleDiffFiles(files, 15).map((file) => file.filePath)).toEqual(
      files.slice(0, 15).map((file) => file.filePath),
    )
    expect(getVisibleDiffFiles(files, 15, 'abc123').map((file) => file.filePath)).toEqual(
      files.map((file) => file.filePath),
    )
  })

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
      makeFile(2, {
        additions: 0,
        deletions: 4,
        staged: true,
        patch: '',
      }),
    ]

    expect(getDiffFileChangeStats(files[0])).toEqual({ additions: 8, deletions: 3 })
    expect(getDiffReviewSummary(files)).toEqual({
      additions: 8,
      deletions: 7,
      staged: 1,
      unstaged: 1,
    })
  })

  it('builds a measured virtual file layout and windows by scroll position', () => {
    const files = Array.from({ length: 5 }, (_, index) => makeFile(index))
    const collapsed = new Set([files[1]!.filePath])
    const measured = new Map([
      [files[0]!.filePath, 100],
      [files[1]!.filePath, 50],
      [files[2]!.filePath, 200],
      [files[3]!.filePath, 300],
      [files[4]!.filePath, 400],
    ])

    const layout = buildDiffFileVirtualLayout(files, collapsed, measured)

    expect(layout.map((item) => item.top)).toEqual([0, 100, 150, 350, 650])
    expect(layout.map((item) => item.height)).toEqual([100, 50, 200, 300, 400])

    const win = getVirtualDiffFileWindow(layout, 175, 100, 0)
    expect(win.items.map((item) => item.filePath)).toEqual([files[2]!.filePath])
    expect(win.beforeHeight).toBe(150)
    expect(win.afterHeight).toBe(700)
    expect(win.totalHeight).toBe(1050)
  })

  it('expands the virtual window to include an off-screen scroll target file', () => {
    const files = Array.from({ length: 5 }, (_, index) => makeFile(index))
    const layout = buildDiffFileVirtualLayout(files, new Set(), new Map(
      files.map((file) => [file.filePath, 100]),
    ))
    const windowAtTop = getVirtualDiffFileWindow(layout, 0, 100, 0)
    expect(windowAtTop.items.map((item) => item.filePath)).toEqual([files[0]!.filePath])

    const expanded = ensureFileInVirtualWindow(windowAtTop, layout, files[4]!.filePath)
    expect(expanded.items.map((item) => item.filePath)).toEqual(
      files.map((file) => file.filePath),
    )
    expect(getScrollTopForFileHeader(layout, files[4]!.filePath, 100)).toBe(400)
  })

  it('clamps overscrolled windows so at least one file section stays visible', () => {
    const files = Array.from({ length: 3 }, (_, index) => makeFile(index))
    const layout = buildDiffFileVirtualLayout(files, new Set(), new Map(
      files.map((file) => [file.filePath, 100]),
    ))

    const overscrolled = getVirtualDiffFileWindow(layout, 10_000, 100, 0)
    expect(overscrolled.items.length).toBeGreaterThan(0)
    expect(overscrolled.items.at(-1)?.filePath).toBe(files[2]!.filePath)
    expect(overscrolled.beforeHeight).toBeLessThan(overscrolled.totalHeight)
  })

  it('clamps scroll restoration when layout height shrinks', () => {
    const files = [makeFile(0), makeFile(1)]
    const collapsed = new Set<string>()
    const before = buildDiffFileVirtualLayout(files, collapsed, new Map([
      [files[0]!.filePath, 100],
      [files[1]!.filePath, 400],
    ]))
    const anchor = captureDiffScrollAnchor(before, 430)
    const after = buildDiffFileVirtualLayout(files, collapsed, new Map([
      [files[0]!.filePath, 80],
      [files[1]!.filePath, 120],
    ]))

    expect(restoreDiffScrollTop(after, anchor!, 100)).toBe(clampDiffScrollTop(430, after, 100))
  })

  it('uses cheap estimates before files are measured', () => {
    const file = makeFile(1, { additions: 3, deletions: 2 })

    expect(estimateDiffFileHeight(file, true)).toBeLessThan(estimateDiffFileHeight(file, false))
    expect(estimateDiffFileHeight(file, false, 123)).toBe(123)
  })

  it('finds the header-owning file from scroll position', () => {
    const files = Array.from({ length: 3 }, (_, index) => makeFile(index))
    const layout = buildDiffFileVirtualLayout(files, new Set(), new Map([
      [files[0]!.filePath, 100],
      [files[1]!.filePath, 200],
      [files[2]!.filePath, 300],
    ]))

    expect(findHeaderOwningFileSection(layout, 0)?.filePath).toBe(files[0]!.filePath)
    expect(findHeaderOwningFileSection(layout, 150)?.filePath).toBe(files[1]!.filePath)
    expect(findHeaderOwningFileSection(layout, 500)?.filePath).toBe(files[2]!.filePath)
  })

  it('collects intersecting file sections inside a viewport band', () => {
    const files = Array.from({ length: 4 }, (_, index) => makeFile(index))
    const layout = buildDiffFileVirtualLayout(files, new Set(), new Map(
      files.map((file) => [file.filePath, 100]),
    ))

    expect(collectIntersectingFileSectionIds(layout, 120, 220)).toEqual([
      files[1]!.filePath,
      files[2]!.filePath,
    ])
  })

  it('restores scroll position from a captured anchor after layout changes', () => {
    const files = [makeFile(0), makeFile(1)]
    const collapsed = new Set<string>()
    const before = buildDiffFileVirtualLayout(files, collapsed, new Map([
      [files[0]!.filePath, 100],
      [files[1]!.filePath, 400],
    ]))
    const anchor = captureDiffScrollAnchor(before, 130)
    expect(anchor).toEqual({
      filePath: files[1]!.filePath,
      offsetFromViewportTop: 30,
    })

    const after = buildDiffFileVirtualLayout(files, collapsed, new Map([
      [files[0]!.filePath, 120],
      [files[1]!.filePath, 500],
    ]))
    expect(restoreDiffScrollTop(after, anchor!, 100)).toBe(150)
  })

  it('buildDiffLayoutAnchorKey changes when layout-affecting inputs change', () => {
    const base = buildDiffLayoutAnchorKey({
      inline: false,
      defaultShowFullContext: false,
      collapsedFilePaths: new Set(['a.ts']),
      annotationIds: ['ann-1'],
      fileDiffTokens: ['a.ts:d', 'b.ts:p'],
      measuredHeightTokens: ['a.ts:100'],
    })
    const same = buildDiffLayoutAnchorKey({
      inline: false,
      defaultShowFullContext: false,
      collapsedFilePaths: new Set(['a.ts']),
      annotationIds: ['ann-1'],
      fileDiffTokens: ['a.ts:d', 'b.ts:p'],
      measuredHeightTokens: ['a.ts:100'],
    })
    const afterAnnotation = buildDiffLayoutAnchorKey({
      inline: false,
      defaultShowFullContext: false,
      collapsedFilePaths: new Set(['a.ts']),
      annotationIds: ['ann-1', 'ann-2'],
      fileDiffTokens: ['a.ts:d', 'b.ts:p'],
      measuredHeightTokens: ['a.ts:100'],
    })
    const afterFileDiff = buildDiffLayoutAnchorKey({
      inline: false,
      defaultShowFullContext: false,
      collapsedFilePaths: new Set(['a.ts']),
      annotationIds: ['ann-1'],
      fileDiffTokens: ['a.ts:d', 'b.ts:d'],
      measuredHeightTokens: ['a.ts:100'],
    })

    expect(same).toBe(base)
    expect(afterAnnotation).not.toBe(base)
    expect(afterFileDiff).not.toBe(base)
  })
})
