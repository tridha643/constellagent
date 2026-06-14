import type { FileDiffMetadata } from '@pierre/diffs'

/**
 * Soft per-file diff ceiling (mirrors GitService.MAX_FILE_DIFF_BYTES). Files
 * whose patch exceeds this load only on demand via a "load anyway" placeholder.
 */
export const MAX_FILE_DIFF_BYTES = 1.5 * 1024 * 1024

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
  /**
   * Set when the file's diff exceeds the per-file byte ceiling and was skipped.
   * The viewer shows a "load anyway" placeholder; clicking re-fetches with force.
   */
  tooLarge?: boolean
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
