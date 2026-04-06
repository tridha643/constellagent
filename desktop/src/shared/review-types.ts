export interface ReviewComment {
  id: string
  workspace_id: string | null
  repo_root: string
  worktree_path: string | null
  file_path: string
  side: 'new' | 'old'
  line_start: number
  line_end: number
  summary: string
  rationale: string | null
  author: string | null
  head_sha: string | null
  resolved: boolean
  created_at: string
  updated_at: string
}
