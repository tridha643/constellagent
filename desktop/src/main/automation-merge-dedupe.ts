/**
 * Cross-source dedupe for PR merge automation events (GitHub poll vs Composio webhook forward).
 * Same logical merge should only emit once within TTL_MS.
 */

const TTL_MS = 120_000
const MAX_KEYS = 512

const seen = new Map<string, number>()

function prune(now: number): void {
  if (seen.size <= MAX_KEYS) return
  const cutoff = now - TTL_MS
  for (const [k, t] of seen) {
    if (t < cutoff) seen.delete(k)
  }
  while (seen.size > MAX_KEYS) {
    const first = seen.keys().next().value as string | undefined
    if (first === undefined) break
    seen.delete(first)
  }
}

/** @returns true if this event should be emitted; false if it is a duplicate. */
export function shouldEmitMergeDedupeKey(dedupeKey: string): boolean {
  const now = Date.now()
  const last = seen.get(dedupeKey)
  if (last !== undefined && now - last < TTL_MS) return false
  seen.set(dedupeKey, now)
  prune(now)
  return true
}

export function mergeDedupeKeyForGithubPr(repoFullName: string, prNumber: number): string {
  return `pr-merge:${repoFullName.toLowerCase()}#${prNumber}`
}
