/**
 * Linear Cmd+F query normalization (single fuzzy string; native fff handles ranking).
 */

import type { LinearUserNode } from './linear-api'

/** Collapse internal whitespace (like normalizing a repo-relative search string). */
export function normalizeLinearQuickOpenQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function tokenizeLinearQuickOpenQuery(normalized: string): string[] {
  if (!normalized) return []
  return normalized.split(' ').filter((t) => t.length > 0)
}

function escapeRegexToken(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Default remote issue search: **your** assigned + created issues (`mine`).
 * Use **workspace** when the query looks like it names another member (word-boundary match on name tokens).
 */
export function linearRemoteIssueSearchAudience(
  normalizedQuery: string,
  viewer: { id: string; name: string } | null,
  workspaceUsers: LinearUserNode[],
): 'mine' | 'workspace' {
  if (!viewer) return 'workspace'
  const q = normalizedQuery.trim().toLowerCase()
  if (!q) return 'mine'

  for (const u of workspaceUsers) {
    if (u.id === viewer.id) continue
    const raw = `${u.displayName?.trim() ?? ''} ${u.name ?? ''}`.trim()
    if (!raw) continue
    const parts = raw
      .toLowerCase()
      .split(/[\s@,.'’_-]+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2)
    for (const part of parts) {
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegexToken(part)}(?:[^a-z0-9]|$)`, 'i')
      if (re.test(q)) return 'workspace'
    }
  }
  return 'mine'
}
