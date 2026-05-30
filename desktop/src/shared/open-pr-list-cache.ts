import type { OpenPrInfo } from './github-types'

/** Shared TTL for renderer local store and main-process IPC cache. */
export const OPEN_PR_LIST_CACHE_MS = 5 * 60 * 1000

export interface OpenPrListCacheEntry {
  fetchedAt: number
  available: boolean
  error: string | null
  data: readonly OpenPrInfo[]
}

export function isOpenPrListCacheFresh(
  fetchedAt: number,
  now: number = Date.now(),
): boolean {
  return now - fetchedAt < OPEN_PR_LIST_CACHE_MS
}

/** Renderer-local open-PR store keyed by repo path (window-backed for a single cache across bundles). */
export function getRendererOpenPrListCacheStore(): Map<string, OpenPrListCacheEntry> {
  const w = window as Window & { __composerOpenPrListByRepo?: Map<string, OpenPrListCacheEntry> }
  if (!w.__composerOpenPrListByRepo) {
    w.__composerOpenPrListByRepo = new Map()
  }
  return w.__composerOpenPrListByRepo
}

export function writeRendererOpenPrListCache(
  repoPath: string,
  entry: OpenPrListCacheEntry,
): void {
  if (entry.available) {
    getRendererOpenPrListCacheStore().set(repoPath, entry)
  }
}

export function getRendererOpenPrListInFlightStore(): Map<string, Promise<OpenPrListCacheEntry>> {
  const w = window as Window & {
    __composerOpenPrListInFlight?: Map<string, Promise<OpenPrListCacheEntry>>
  }
  if (!w.__composerOpenPrListInFlight) {
    w.__composerOpenPrListInFlight = new Map()
  }
  return w.__composerOpenPrListInFlight
}

/** Fresh empty cache should not block a refetch — sidebar may have warmed [] before PRs exist. */
export function shouldSkipOpenPrListPrefetch(
  entry: OpenPrListCacheEntry | undefined,
  now: number = Date.now(),
): boolean {
  return Boolean(entry && isOpenPrListCacheFresh(entry.fetchedAt, now) && entry.data.length > 0)
}
