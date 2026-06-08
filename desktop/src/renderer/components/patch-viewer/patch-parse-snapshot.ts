import type { FileDiffMetadata } from '@pierre/diffs'
import type { DiffFileData } from '../../types/working-tree-diff'
import { getPatchParseKey, getPierreCacheKey, isCombinedMergePatch } from './patch-utils'

/** A single file still needing parse: stable cache key + the single-file patch. */
export interface ParseWorkItem {
  key: string
  patch: string
  cacheKey: string
}

export interface ParseBudget {
  /** Max files to parse synchronously on the main thread per pass. */
  maxFiles: number
  /** Max total patch bytes to parse synchronously per pass. */
  maxBytes: number
}

/**
 * Build the parsed-metadata snapshot for `files`, reusing `cache`, parsing
 * uncached files inline up to `budget`, and returning the rest as `overflow` to
 * be parsed off the main thread. Pure except for populating `cache` (a
 * memoization side effect); `parse` is injected so this is unit-testable without
 * the worker module.
 */
export function buildParseSnapshot(
  files: readonly DiffFileData[],
  cache: Map<string, FileDiffMetadata>,
  parse: (patch: string, cacheKey: string) => FileDiffMetadata | null,
  budget: ParseBudget,
): { snapshot: Map<string, FileDiffMetadata>; overflow: ParseWorkItem[] } {
  const snapshot = new Map<string, FileDiffMetadata>()
  const overflow: ParseWorkItem[] = []
  const seen = new Set<string>()
  let syncFiles = 0
  let syncBytes = 0

  for (const file of files) {
    if (!file.patch || isCombinedMergePatch(file.patch)) continue
    const key = getPatchParseKey(file)
    if (seen.has(key)) continue
    seen.add(key)

    const cached = cache.get(key)
    if (cached) {
      snapshot.set(key, cached)
      continue
    }

    const cacheKey = getPierreCacheKey(file)
    if (syncFiles < budget.maxFiles && syncBytes < budget.maxBytes) {
      syncFiles += 1
      syncBytes += file.patch.length
      const metadata = parse(file.patch, cacheKey)
      if (metadata) {
        cache.set(key, metadata)
        snapshot.set(key, metadata)
      }
      continue
    }

    overflow.push({ key, patch: file.patch, cacheKey })
  }

  return { snapshot, overflow }
}
