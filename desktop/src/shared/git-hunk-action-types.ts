export type GitHunkAction = 'keep' | 'undo'

export type GitHunkActionFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'

export interface GitHunkActionRequest {
  filePath: string
  patch: string
  /** UI/Pierre hunk index — kept for optimistic diff state; git apply resolves by span. */
  hunkIndex: number
  /** Stable @@ anchors so patch hunk lookup survives lazy hydration and partial keeps. */
  deletionStart: number
  additionStart: number
  action: GitHunkAction
  status: GitHunkActionFileStatus
}
