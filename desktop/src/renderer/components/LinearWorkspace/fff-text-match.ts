import { fuzzyMatchSubsequence } from '../../linear/linear-jump-index'

/**
 * Tokenize a haystack into lowercase chunks split on whitespace and
 * common separators so a prefix fallback can match against individual
 * words (e.g. "ENG-123", "my-branch/foo.ts", "Project Name").
 */
function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[\s\-_/.,:;]+/u).filter(Boolean)
}

/**
 * Client-side text matcher used by every "Filter …" input in the
 * Linear panel (Issues / Tickets / Projects / Updates).
 *
 * 1. Primary: fff-style fuzzy subsequence match (same algorithm the
 *    native FileFinder index uses for quick-open), so typing "lp" can
 *    match "Linear Panel".
 * 2. Fallback: prefix match — on either the full string or any of its
 *    whitespace/punctuation-separated tokens — so short queries like
 *    "li" still match "Linear" even when the fuzzy matcher returns no
 *    hit (defensive safety net).
 *
 * Returns `true` for an empty / whitespace-only query so callers can
 * short-circuit list building.
 */
export function matchesFffQuery(haystack: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  if (!haystack) return false

  if (fuzzyMatchSubsequence(q, haystack) != null) return true

  const needle = q.toLowerCase()
  const lower = haystack.toLowerCase()
  if (lower.startsWith(needle)) return true
  for (const token of tokenize(haystack)) {
    if (token.startsWith(needle)) return true
  }
  return false
}
