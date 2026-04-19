import type { GraphiteStackInfo } from '../../../shared/graphite-types'

/**
 * Single line for the workspace/stack pill: active repo context with Graphite preferred over
 * a plain workspace branch when both exist (Constell-local; not from Linear).
 */
export function formatLinearWorkContextLabel(
  workspaceBranch: string | null,
  graphite: GraphiteStackInfo | null,
): string {
  const branch = workspaceBranch?.trim() || null

  if (graphite && graphite.branches.length > 0) {
    const cur =
      graphite.currentBranch.trim() ||
      graphite.branches[graphite.branches.length - 1]?.name.trim() ||
      ''
    if (graphite.branches.length > 1) {
      return cur ? `${cur} · stack` : 'stack'
    }
    if (cur) return cur
  }

  return branch ?? 'no workspace'
}
