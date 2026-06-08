import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs'

/**
 * CodeView applies `expandUnchanged` globally, but our "show full file" toggle is
 * per-file. We emulate per-file full expansion by re-parsing the full content
 * with a context window larger than the file, producing a single gap-free hunk —
 * so the whole file renders with no collapsed-context separators regardless of
 * the global option. Memoized by the source metadata object (stable until the
 * file's patch changes / reloads).
 */
const cache = new WeakMap<FileDiffMetadata, FileDiffMetadata>()

export function getFullyExpandedMetadata(fileDiff: FileDiffMetadata): FileDiffMetadata {
  const cached = cache.get(fileDiff)
  if (cached) return cached

  // Only full (non-partial) metadata carries complete old/new content.
  if (fileDiff.isPartial) {
    cache.set(fileDiff, fileDiff)
    return fileDiff
  }

  const oldContent = fileDiff.deletionLines.join('\n')
  const newContent = fileDiff.additionLines.join('\n')
  const context = Math.max(fileDiff.additionLines.length, fileDiff.deletionLines.length) + 16

  let expanded: FileDiffMetadata
  try {
    expanded = parseDiffFromFile(
      { name: fileDiff.prevName ?? fileDiff.name, contents: oldContent },
      { name: fileDiff.name, contents: newContent },
      { context },
    )
    if (expanded.cacheKey == null && fileDiff.cacheKey) expanded.cacheKey = `${fileDiff.cacheKey}:full`
  } catch {
    expanded = fileDiff
  }
  cache.set(fileDiff, expanded)
  return expanded
}
