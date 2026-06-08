/**
 * Off-main-thread patch parser (rudu's `pierre-patch-parser-worker.ts` shape).
 *
 * CodeView wants a pre-parsed `FileDiffMetadata` per item, so we parse each
 * file's working-tree patch off the main thread. `getSingularPatch` builds the
 * partial (patch-only) metadata — the same builder `DiffFileSection` used on the
 * main thread, just moved into a worker. The host falls back to main-thread
 * parsing if the worker fails to construct or errors (see `usePatchParsing`).
 *
 * electron-vite renderer `worker.format: 'es'` — imported elsewhere via `?worker`.
 */
import { getSingularPatch, type FileDiffMetadata } from '@pierre/diffs'

export interface PatchParseRequest {
  id: number
  /** Items to parse this batch: a stable cache key + the unified single-file patch. */
  items: { key: string; patch: string; cacheKey: string }[]
}

export interface PatchParseResult {
  id: number
  results: { key: string; metadata: FileDiffMetadata | null }[]
}

function parseOne(patch: string, cacheKey: string): FileDiffMetadata | null {
  try {
    const metadata = getSingularPatch(patch)
    if (metadata && metadata.cacheKey == null) metadata.cacheKey = cacheKey
    return metadata
  } catch {
    return null
  }
}

self.onmessage = (event: MessageEvent<PatchParseRequest>) => {
  const { id, items } = event.data
  const results = items.map((item) => ({
    key: item.key,
    metadata: parseOne(item.patch, item.cacheKey),
  }))
  const message: PatchParseResult = { id, results }
  ;(self as unknown as Worker).postMessage(message)
}

export {}
