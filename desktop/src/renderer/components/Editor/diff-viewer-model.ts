import type { DiffFileData } from '../../types/working-tree-diff'
import { diffStatsFromPatch } from '../DiffPreview/diff-model'

const COLLAPSED_FILE_HEIGHT = 42
const EXPANDED_FILE_BASE_HEIGHT = 84
const LOADING_FILE_HEIGHT = 76
const EMPTY_FILE_HEIGHT = 70
const DIFF_ROW_HEIGHT = 24
const HUNK_SEPARATOR_HEIGHT = 28
const MIN_EXPANDED_FILE_HEIGHT = 132
const FILE_SECTION_HEADER_HEIGHT = COLLAPSED_FILE_HEIGHT
const DEFAULT_DIFF_VIEWPORT_HEIGHT = 900

export interface DiffFileVirtualLayoutItem {
  readonly file: DiffFileData
  readonly index: number
  readonly filePath: string
  readonly top: number
  readonly height: number
  readonly headerTop: number
  readonly bodyTop: number
  readonly bodyHeight: number
  readonly sectionBottom: number
  readonly collapsed: boolean
}

export interface DiffScrollAnchor {
  readonly filePath: string
  readonly offsetFromViewportTop: number
}

export interface DiffFileVirtualWindow {
  readonly items: readonly DiffFileVirtualLayoutItem[]
  readonly startIndex: number
  readonly endIndex: number
  readonly beforeHeight: number
  readonly afterHeight: number
  readonly totalHeight: number
}

export function getVisibleDiffFiles(
  files: readonly DiffFileData[],
  visibleCount: number,
  commitHash?: string,
): DiffFileData[] {
  if (commitHash) return [...files]
  return files.slice(0, visibleCount)
}

export function getDiffFileChangeStats(
  file: Pick<DiffFileData, 'patch' | 'additions' | 'deletions'>,
): { additions: number; deletions: number } {
  if (file.additions != null || file.deletions != null) {
    return {
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    }
  }
  return diffStatsFromPatch(file.patch)
}

export function getDiffFileReviewLineCount(
  file: Pick<DiffFileData, 'patch' | 'additions' | 'deletions'>,
): number {
  if (file.additions != null || file.deletions != null) {
    return (file.additions ?? 0) + (file.deletions ?? 0)
  }
  return file.patch ? file.patch.split('\n').length : 0
}

function getPatchHunkCount(patch: string): number {
  if (!patch) return 0
  const matches = patch.match(/^@@ /gm)
  return matches?.length ?? 0
}

export function estimateDiffFileHeight(
  file: DiffFileData,
  collapsed: boolean,
  measuredHeight?: number,
): number {
  if (measuredHeight != null && measuredHeight > 0) {
    return Math.ceil(measuredHeight)
  }
  if (collapsed) return COLLAPSED_FILE_HEIGHT
  if (file.patchLoaded === false) return LOADING_FILE_HEIGHT
  if (!file.patch && !file.fileDiff) return EMPTY_FILE_HEIGHT

  const renderedLineCount = file.fileDiff
    ? Math.max(file.fileDiff.splitLineCount, file.fileDiff.unifiedLineCount)
    : getDiffFileReviewLineCount(file)
  const hunkCount = file.fileDiff?.hunks.length ?? getPatchHunkCount(file.patch)
  const estimatedHeight =
    EXPANDED_FILE_BASE_HEIGHT
    + renderedLineCount * DIFF_ROW_HEIGHT
    + hunkCount * HUNK_SEPARATOR_HEIGHT

  return Math.max(MIN_EXPANDED_FILE_HEIGHT, estimatedHeight)
}

export function buildDiffFileVirtualLayout(
  files: readonly DiffFileData[],
  collapsedFilePaths: ReadonlySet<string>,
  measuredHeights: ReadonlyMap<string, number>,
): DiffFileVirtualLayoutItem[] {
  const layout: DiffFileVirtualLayoutItem[] = []
  let top = 0

  files.forEach((file, index) => {
    const collapsed = collapsedFilePaths.has(file.filePath)
    const measured = measuredHeights.get(file.filePath)
    const height = estimateDiffFileHeight(file, collapsed, measured)
    layout.push({
      file,
      index,
      filePath: file.filePath,
      top,
      height,
      headerTop: top,
      bodyTop: collapsed ? top + height : top + FILE_SECTION_HEADER_HEIGHT,
      bodyHeight: collapsed ? 0 : Math.max(0, height - FILE_SECTION_HEADER_HEIGHT),
      sectionBottom: top + height,
      collapsed,
    })
    top += height
  })

  return layout
}

export function findHeaderOwningFileSection(
  layout: readonly DiffFileVirtualLayoutItem[],
  scrollTop: number,
): DiffFileVirtualLayoutItem | null {
  if (layout.length === 0) return null
  let lo = 0
  let hi = layout.length - 1
  let best: DiffFileVirtualLayoutItem | null = null
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const item = layout[mid]
    if (!item) break
    if (item.headerTop <= scrollTop) {
      best = item
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

export function collectIntersectingFileSectionIds(
  layout: readonly DiffFileVirtualLayoutItem[],
  minY: number,
  maxY: number,
): string[] {
  if (layout.length === 0 || maxY <= minY) return []
  const start = findFirstItemWithBottomAfter(layout, minY)
  const paths: string[] = []
  for (let i = start; i < layout.length; i += 1) {
    const item = layout[i]
    if (!item || item.top >= maxY) break
    paths.push(item.filePath)
  }
  return paths
}

export function captureDiffScrollAnchor(
  layout: readonly DiffFileVirtualLayoutItem[],
  scrollTop: number,
): DiffScrollAnchor | null {
  const owner = findHeaderOwningFileSection(layout, scrollTop)
  if (!owner) return null
  return {
    filePath: owner.filePath,
    offsetFromViewportTop: scrollTop - owner.headerTop,
  }
}

export function getDiffVirtualScrollMax(
  layout: readonly DiffFileVirtualLayoutItem[],
  viewportHeight: number,
): number {
  if (layout.length === 0) return 0
  const totalHeight = layout[layout.length - 1]!.top + layout[layout.length - 1]!.height
  return Math.max(0, totalHeight - Math.max(1, viewportHeight))
}

export function clampDiffScrollTop(
  scrollTop: number,
  layout: readonly DiffFileVirtualLayoutItem[],
  viewportHeight: number,
): number {
  if (!Number.isFinite(scrollTop) || scrollTop <= 0) return 0
  return Math.min(scrollTop, getDiffVirtualScrollMax(layout, viewportHeight))
}

export function restoreDiffScrollTop(
  layout: readonly DiffFileVirtualLayoutItem[],
  anchor: DiffScrollAnchor,
  viewportHeight = DEFAULT_DIFF_VIEWPORT_HEIGHT,
): number | null {
  const item = layout.find((entry) => entry.filePath === anchor.filePath)
  if (!item) return null
  const restored = Math.max(0, item.headerTop + anchor.offsetFromViewportTop)
  return clampDiffScrollTop(restored, layout, viewportHeight)
}

function findFirstItemWithBottomAfter(
  layout: readonly DiffFileVirtualLayoutItem[],
  target: number,
): number {
  let lo = 0
  let hi = layout.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const item = layout[mid]
    if (!item || item.top + item.height <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function findFirstItemWithTopAfter(
  layout: readonly DiffFileVirtualLayoutItem[],
  target: number,
): number {
  let lo = 0
  let hi = layout.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const item = layout[mid]
    if (!item || item.top < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Expand a virtual window so a target file is mounted even when off-screen (hunk/rudu pattern). */
export function ensureFileInVirtualWindow(
  window: DiffFileVirtualWindow,
  layout: readonly DiffFileVirtualLayoutItem[],
  filePath: string,
): DiffFileVirtualWindow {
  const fileIndex = layout.findIndex((item) => item.filePath === filePath)
  if (fileIndex < 0) return window
  if (fileIndex >= window.startIndex && fileIndex < window.endIndex) return window

  const startIndex = Math.min(window.startIndex, fileIndex)
  const endIndex = Math.max(window.endIndex, fileIndex + 1)
  const items = layout.slice(startIndex, endIndex)
  const totalHeight = layout.length === 0
    ? 0
    : layout[layout.length - 1]!.top + layout[layout.length - 1]!.height
  const first = items[0]!
  const last = items[items.length - 1]!

  return {
    items,
    startIndex,
    endIndex,
    beforeHeight: first.top,
    afterHeight: Math.max(0, totalHeight - (last.top + last.height)),
    totalHeight,
  }
}

export function getScrollTopForFileHeader(
  layout: readonly DiffFileVirtualLayoutItem[],
  filePath: string,
  viewportHeight: number,
): number | null {
  const item = layout.find((entry) => entry.filePath === filePath)
  if (!item) return null
  return clampDiffScrollTop(item.headerTop, layout, viewportHeight)
}

export function getVirtualDiffFileWindow(
  layout: readonly DiffFileVirtualLayoutItem[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
): DiffFileVirtualWindow {
  const totalHeight = layout.length === 0
    ? 0
    : layout[layout.length - 1]!.top + layout[layout.length - 1]!.height
  if (layout.length === 0) {
    return {
      items: [],
      startIndex: 0,
      endIndex: 0,
      beforeHeight: 0,
      afterHeight: 0,
      totalHeight,
    }
  }

  const clampedScrollTop = clampDiffScrollTop(scrollTop, layout, viewportHeight)
  const windowTop = Math.max(0, clampedScrollTop - overscanPx)
  const windowBottom = Math.min(
    totalHeight,
    clampedScrollTop + Math.max(1, viewportHeight) + overscanPx,
  )
  let startIndex = Math.min(layout.length, findFirstItemWithBottomAfter(layout, windowTop))
  if (startIndex >= layout.length) startIndex = layout.length - 1
  let endIndex = Math.min(layout.length, findFirstItemWithTopAfter(layout, windowBottom))
  if (endIndex <= startIndex) endIndex = Math.min(layout.length, startIndex + 1)

  const items = layout.slice(startIndex, endIndex)
  const safeItems = items.length > 0 ? items : [layout[startIndex]!]
  const safeStartIndex = safeItems[0]?.index ?? startIndex
  const safeEndIndex = safeStartIndex + safeItems.length
  const beforeHeight = safeItems[0]?.top ?? 0
  const last = safeItems[safeItems.length - 1]
  const afterHeight = last ? Math.max(0, totalHeight - (last.top + last.height)) : 0

  return {
    items: safeItems,
    startIndex: safeStartIndex,
    endIndex: safeEndIndex,
    beforeHeight,
    afterHeight,
    totalHeight,
  }
}

/** Stable key for scroll-anchor capture when layout-affecting inputs change. */
export function buildDiffLayoutAnchorKey(input: {
  inline: boolean
  defaultShowFullContext: boolean
  collapsedFilePaths: ReadonlySet<string>
  annotationIds: readonly string[]
  fileDiffTokens: readonly string[]
  measuredHeightTokens: readonly string[]
}): string {
  const collapsed = [...input.collapsedFilePaths].sort().join('\u0001')
  return [
    input.inline ? '1' : '0',
    input.defaultShowFullContext ? '1' : '0',
    collapsed,
    input.annotationIds.join('\u0002'),
    input.fileDiffTokens.join('\u0003'),
    input.measuredHeightTokens.join('\u0004'),
  ].join('\u0005')
}

export function getDiffReviewSummary(files: readonly DiffFileData[]): {
  additions: number
  deletions: number
  staged: number
  unstaged: number
} {
  let additions = 0
  let deletions = 0
  let staged = 0
  let unstaged = 0

  for (const file of files) {
    const stats = getDiffFileChangeStats(file)
    additions += stats.additions
    deletions += stats.deletions
    if (file.staged) staged += 1
    else unstaged += 1
  }

  return { additions, deletions, staged, unstaged }
}
