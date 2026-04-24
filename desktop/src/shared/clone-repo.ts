export const CLONE_REPO_STAGES = [
  'validate-url',
  'prepare-destination',
  'cloning',
  'finalizing',
] as const

export type CloneRepoStage = (typeof CLONE_REPO_STAGES)[number]

export interface CloneRepoProgress {
  stage: CloneRepoStage
  message: string
  /** 0-100 during `cloning`; undefined for other stages. */
  percent?: number
}

export interface CloneRepoProgressEvent extends CloneRepoProgress {
  requestId: string
}

export interface CloneRepoOptions {
  url: string
  destPath: string
  requestId: string
}

export interface CloneRepoResult {
  repoPath: string
  defaultBranch: string
}

export const CLONE_ERROR_CODES = {
  AUTH_FAILED: 'CLONE_AUTH_FAILED',
  NETWORK: 'CLONE_NETWORK_ERROR',
  NOT_FOUND: 'CLONE_NOT_FOUND',
  DEST_EXISTS_REPO: 'CLONE_DEST_EXISTS_REPO',
  DEST_EXISTS_NON_EMPTY: 'CLONE_DEST_EXISTS_NON_EMPTY',
  CANCELLED: 'CLONE_CANCELLED',
  INVALID_URL: 'CLONE_INVALID_URL',
} as const
