import type { DiffAnnotationSide } from '@shared/diff-annotation-types'

export interface DiffPendingCommentRange {
  side: DiffAnnotationSide
  lineNumber: number
  lineEnd: number
}

export interface DiffCommentDraft {
  range: DiffPendingCommentRange
  body: string
}

export function isDiffCommentDraftDirty(draft: DiffCommentDraft | undefined): boolean {
  return (draft?.body ?? '').trim().length > 0
}

/** Playwright-only seam: Pierre shadow-DOM comment affordances are not reliably clickable in e2e. */
export const DIFF_E2E_OPEN_COMMENT_COMPOSER = 'diff:e2e-open-comment-composer'

export interface DiffE2eOpenCommentComposerDetail {
  filePath: string
  lineNumber?: number
  side?: DiffAnnotationSide
}
