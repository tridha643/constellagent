/** Matches `git worktree list --porcelain` (and t3 discovery). */
export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isBare: boolean
  /** Present when not on any branch */
  isDetached?: boolean
}

/**
 * Local-mode workspace bar stats: latest commit subject plus a
 * working-tree-inclusive diff against `merge-base(defaultBranch, HEAD)`.
 * `headSha` lets the poller skip recompute when HEAD is unchanged.
 */
export interface WorkspaceBarStats {
  subject: string
  additions: number
  deletions: number
  headSha: string
}
