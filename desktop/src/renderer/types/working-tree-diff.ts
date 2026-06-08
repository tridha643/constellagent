import type { FileDiffMetadata } from '@pierre/diffs'

export interface WorkingTreeFileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
  additions?: number
  deletions?: number
}

export interface DiffFileData {
  filePath: string
  patch: string
  status: WorkingTreeFileStatus['status']
  staged?: boolean
  additions?: number
  deletions?: number
  hasMixedStageState?: boolean
  fileDiff?: FileDiffMetadata
  patchLoaded?: boolean
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
    ...statuses.map((status) => [
      status.path,
      status.status,
      status.staged ? '1' : '0',
      status.additions ?? '',
      status.deletions ?? '',
    ].join('\u0000')),
  ].join('\n')
}
