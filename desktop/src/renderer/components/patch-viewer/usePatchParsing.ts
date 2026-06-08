import { useEffect, useMemo, useRef, useState } from 'react'
import { getSingularPatch, type FileDiffMetadata } from '@pierre/diffs'
import type { DiffFileData } from '../../types/working-tree-diff'
import PatchParserWorker from './pierre-patch-parser-worker?worker'
import type { PatchParseRequest, PatchParseResult } from './pierre-patch-parser-worker'
import { getPatchParseKey, getPierreCacheKey, isCombinedMergePatch } from './patch-utils'

/** Parsed patch-only metadata keyed by `getPatchParseKey(file)`. */
export type ParsedPatchMap = ReadonlyMap<string, FileDiffMetadata>

function parseOnMainThread(patch: string, cacheKey: string): FileDiffMetadata | null {
  try {
    const metadata = getSingularPatch(patch)
    if (metadata && metadata.cacheKey == null) metadata.cacheKey = cacheKey
    return metadata
  } catch {
    return null
  }
}

/**
 * Decoupled parse layer (rudu's `usePatchParsing`). Parses every parseable
 * working-tree patch into `FileDiffMetadata` off the main thread, with a
 * main-thread fallback. Combined-merge patches are skipped (rendered via the raw
 * fallback). Results are memo-cached by patch identity so re-renders and
 * progressive `addItems` don't re-parse unchanged files.
 */
export function usePatchParsing(files: readonly DiffFileData[]): ParsedPatchMap {
  const [parsed, setParsed] = useState<ReadonlyMap<string, FileDiffMetadata>>(() => new Map())
  const cacheRef = useRef<Map<string, FileDiffMetadata>>(new Map())
  const workerRef = useRef<Worker | null>(null)
  const workerBrokenRef = useRef(false)
  const requestSeqRef = useRef(0)
  const pendingRef = useRef<Map<number, (result: PatchParseResult) => void>>(new Map())

  // Lazily construct the worker; if it throws we fall back to main-thread parse.
  if (workerRef.current == null && !workerBrokenRef.current) {
    try {
      const worker = new PatchParserWorker()
      worker.onmessage = (event: MessageEvent<PatchParseResult>) => {
        const resolve = pendingRef.current.get(event.data.id)
        if (resolve) {
          pendingRef.current.delete(event.data.id)
          resolve(event.data)
        }
      }
      worker.onerror = () => {
        workerBrokenRef.current = true
      }
      workerRef.current = worker
    } catch {
      workerBrokenRef.current = true
    }
  }

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      pendingRef.current.clear()
    }
  }, [])

  // The set of (key, patch) we still need parsed metadata for.
  const needed = useMemo(() => {
    const seen = new Set<string>()
    const items: { key: string; patch: string; cacheKey: string }[] = []
    for (const file of files) {
      if (!file.patch || isCombinedMergePatch(file.patch)) continue
      const key = getPatchParseKey(file)
      if (seen.has(key)) continue
      seen.add(key)
      if (cacheRef.current.has(key)) continue
      items.push({ key, patch: file.patch, cacheKey: getPierreCacheKey(file) })
    }
    return items
  }, [files])

  useEffect(() => {
    if (needed.length === 0) {
      // Still publish a map snapshot if cache content was reused for a new file set.
      const snapshot = buildSnapshot(files, cacheRef.current)
      setParsed((prev) => (mapsShareEntries(prev, snapshot) ? prev : snapshot))
      return
    }

    let cancelled = false

    const apply = (results: { key: string; metadata: FileDiffMetadata | null }[]) => {
      if (cancelled) return
      for (const { key, metadata } of results) {
        if (metadata) cacheRef.current.set(key, metadata)
      }
      setParsed(buildSnapshot(files, cacheRef.current))
    }

    const worker = workerRef.current
    if (worker && !workerBrokenRef.current) {
      const id = ++requestSeqRef.current
      const request: PatchParseRequest = { id, items: needed }
      pendingRef.current.set(id, (result) => apply(result.results))
      try {
        worker.postMessage(request)
      } catch {
        workerBrokenRef.current = true
        apply(needed.map((item) => ({ key: item.key, metadata: parseOnMainThread(item.patch, item.cacheKey) })))
      }
    } else {
      apply(needed.map((item) => ({ key: item.key, metadata: parseOnMainThread(item.patch, item.cacheKey) })))
    }

    return () => {
      cancelled = true
    }
  }, [needed, files])

  return parsed
}

function buildSnapshot(
  files: readonly DiffFileData[],
  cache: ReadonlyMap<string, FileDiffMetadata>,
): Map<string, FileDiffMetadata> {
  const snapshot = new Map<string, FileDiffMetadata>()
  for (const file of files) {
    if (!file.patch || isCombinedMergePatch(file.patch)) continue
    const key = getPatchParseKey(file)
    const metadata = cache.get(key)
    if (metadata) snapshot.set(key, metadata)
  }
  return snapshot
}

function mapsShareEntries(
  a: ReadonlyMap<string, FileDiffMetadata>,
  b: ReadonlyMap<string, FileDiffMetadata>,
): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false
  }
  return true
}
