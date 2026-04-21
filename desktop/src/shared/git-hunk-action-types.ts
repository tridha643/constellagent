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
  hunkIndex: number
  action: GitHunkAction
  status: GitHunkActionFileStatus
}
