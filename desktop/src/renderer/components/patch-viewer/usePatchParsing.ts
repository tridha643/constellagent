import { useEffect, useMemo, useState } from 'react'
import { getSingularPatch, type FileDiffMetadata } from '@pierre/diffs'
import type { DiffFileData } from '../../types/working-tree-diff'
import PatchParserWorker from './pierre-patch-parser-worker?worker'
import type { PatchParseRequest, PatchParseResult } from './pierre-patch-parser-worker'
import { buildParseSnapshot, type ParseBudget } from './patch-parse-snapshot'

/** Parsed patch-only metadata keyed by `getPatchParseKey(file)`. */
export type ParsedPatchMap = ReadonlyMap<string, FileDiffMetadata>

/**
 * Parse budget for the main-thread fast path. Anything within this size parses
 * inline on first paint (instant, no worker round-trip); the overflow is handed
 * to the worker so a huge changeset never blocks a frame. Generous on purpose —
 * typical working-tree diffs parse entirely synchronously.
 */
const SYNC_BUDGET: ParseBudget = { maxFiles: 120, maxBytes: 1_000_000 }

/** Cap on the shared cache so long sessions of tab-switching don't grow it forever. */
const MAX_CACHE_ENTRIES = 5000

function parseOnMainThread(patch: string, cacheKey: string): FileDiffMetadata | null {
  try {
    const metadata = getSingularPatch(patch)
    if (metadata && metadata.cacheKey == null) metadata.cacheKey = cacheKey
    return metadata
  } catch {
    return null
  }
}

// ── Module-level shared state ──────────────────────────────────────────────
// The parse cache is content-addressed (`getPatchParseKey` = path + full patch),
// so it is safe to share across every mount: switching diff tabs or reopening
// the review drawer reuses already-parsed metadata instead of re-parsing through
// the worker (the chief reason the surface used to flash blank on open). A
// watcher refresh only re-parses the files whose patch actually changed.
const parseCache = new Map<string, FileDiffMetadata>()

function cachePut(key: string, metadata: FileDiffMetadata | null): void {
  if (metadata == null) return
  parseCache.set(key, metadata)
  if (parseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = parseCache.keys().next().value
    if (oldest !== undefined) parseCache.delete(oldest)
  }
}

// The parser worker is a long-lived singleton kept warm for the app lifetime, so
// no mount pays its (heavy `@pierre/diffs`) cold-start more than once per session.
let sharedWorker: Worker | null = null
let workerBroken = false
let requestSeq = 0
const pendingRequests = new Map<number, (result: PatchParseResult) => void>()

function getParserWorker(): Worker | null {
  if (workerBroken) return null
  if (sharedWorker) return sharedWorker
  try {
    const worker = new PatchParserWorker()
    worker.onmessage = (event: MessageEvent<PatchParseResult>) => {
      const resolve = pendingRequests.get(event.data.id)
      if (resolve) {
        pendingRequests.delete(event.data.id)
        resolve(event.data)
      }
    }
    worker.onerror = () => {
      workerBroken = true
    }
    sharedWorker = worker
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

/**
 * Decoupled parse layer (rudu's `usePatchParsing`). Parses every parseable
 * working-tree patch into `FileDiffMetadata`. The common case — files already in
 * the shared cache, or a normal-sized changeset — is parsed synchronously so the
 * diff is on screen in the first commit with no worker round-trip. Only the
 * overflow of an unusually large changeset is handed to the worker (with a
 * main-thread fallback if it is unavailable). Combined-merge patches are skipped
 * (rendered via the raw fallback).
 */
export function usePatchParsing(files: readonly DiffFileData[]): ParsedPatchMap {
  // Bumped when worker results land so the snapshot recomputes and picks them up.
  const [tick, setTick] = useState(0)

  const { snapshot, overflow } = useMemo(
    () => buildParseSnapshot(files, parseCache, parseOnMainThread, SYNC_BUDGET),
    // `tick` re-runs this after the worker fills the cache; `parseCache` is module
    // state, so the recompute sees the new entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, tick],
  )

  useEffect(() => {
    if (overflow.length === 0) return

    const fallbackToMainThread = () => {
      for (const item of overflow) cachePut(item.key, parseOnMainThread(item.patch, item.cacheKey))
      setTick((t) => t + 1)
    }

    const worker = getParserWorker()
    if (!worker) {
      fallbackToMainThread()
      return
    }

    let cancelled = false
    const id = ++requestSeq
    pendingRequests.set(id, (result) => {
      if (cancelled) return
      for (const { key, metadata } of result.results) cachePut(key, metadata)
      setTick((t) => t + 1)
    })

    const request: PatchParseRequest = { id, items: overflow }
    try {
      worker.postMessage(request)
    } catch {
      workerBroken = true
      pendingRequests.delete(id)
      fallbackToMainThread()
    }

    return () => {
      cancelled = true
      pendingRequests.delete(id)
    }
  }, [overflow])

  return snapshot
}
