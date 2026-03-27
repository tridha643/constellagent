/** Matches `git worktree list --porcelain` (and t3 discovery). */
export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isBare: boolean
  /** Present when not on any branch */
  isDetached?: boolean
}

export interface GitLogEntry {
  hash: string
  parents: string[]
  message: string
  refs: string[]       // e.g. ["HEAD -> main", "origin/main"]
  author: string
  relativeDate: string // e.g. "2 days ago"
}
