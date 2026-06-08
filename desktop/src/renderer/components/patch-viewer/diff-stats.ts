import type { DiffFileData } from '../../types/working-tree-diff'
import { diffStatsFromPatch } from '../DiffPreview/diff-model'

/**
 * Non-windowing diff stats helpers. Relocated verbatim from the retired
 * `diff-viewer-model.ts` — consumed by the patch-viewer header metadata,
 * the toolbar summary, and auto-collapse budgeting. CodeView owns layout, so
 * none of the old height-estimation / virtual-window math survives.
 */

export function getDiffFileChangeStats(
  file: Pick<DiffFileData, 'patch' | 'additions' | 'deletions'>,
): { additions: number; deletions: number } {
  if (file.additions != null || file.deletions != null) {
    return {
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    }
  }
  return diffStatsFromPatch(file.patch)
}

export function getDiffFileReviewLineCount(
  file: Pick<DiffFileData, 'patch' | 'additions' | 'deletions'>,
): number {
  if (file.additions != null || file.deletions != null) {
    return (file.additions ?? 0) + (file.deletions ?? 0)
  }
  return file.patch ? file.patch.split('\n').length : 0
}

export function getDiffReviewSummary(files: readonly DiffFileData[]): {
  additions: number
  deletions: number
  staged: number
  unstaged: number
} {
  let additions = 0
  let deletions = 0
  let staged = 0
  let unstaged = 0

  for (const file of files) {
    const stats = getDiffFileChangeStats(file)
    additions += stats.additions
    deletions += stats.deletions
    if (file.staged) staged += 1
    else unstaged += 1
  }

  return { additions, deletions, staged, unstaged }
}
