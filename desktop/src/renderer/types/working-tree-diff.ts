import type { FileDiffMetadata } from '@pierre/diffs'

export interface WorkingTreeFileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
}

export interface DiffFileData {
  filePath: string
  patch: string
  status: WorkingTreeFileStatus['status']
  staged?: boolean
  hasMixedStageState?: boolean
  fileDiff?: FileDiffMetadata
  currentContent?: string | null
}

export interface GitStatusSnapshot {
  statuses: WorkingTreeFileStatus[]
  headHash: string
  signature: string
  updatedAt: number
}

export interface WorkingTreeDiffSnapshot extends GitStatusSnapshot {
  files: DiffFileData[]
  complete: boolean
}

export function buildWorkingTreeStatusSignature(
  statuses: WorkingTreeFileStatus[],
  headHash: string,
): string {
  return [
    headHash,
    ...statuses.map((status) => `${status.path}\u0000${status.status}\u0000${status.staged ? '1' : '0'}`),
  ].join('\n')
}
