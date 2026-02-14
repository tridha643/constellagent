export const CREATE_WORKTREE_STAGES = [
  'prune-worktrees',
  'fetch-origin',
  'resolve-default-branch',
  'prepare-worktree-dir',
  'inspect-branch',
  'create-worktree',
  'sync-branch',
  'copy-env-files',
] as const

export type CreateWorktreeStage = (typeof CREATE_WORKTREE_STAGES)[number]

export interface CreateWorktreeProgress {
  stage: CreateWorktreeStage
  message: string
}

export interface CreateWorktreeProgressEvent extends CreateWorktreeProgress {
  requestId?: string
}
