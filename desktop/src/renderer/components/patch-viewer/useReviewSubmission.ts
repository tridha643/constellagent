import { useCallback, useMemo, useState } from 'react'
import type { DiffAnnotation } from '@shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import { isSelectableHumanComment } from './review-threads'

export interface ReviewSubmissionState {
  selectedIds: Set<string>
  toggleComment: (id: string) => void
  submit: () => void
  selectableCount: number
  selectedCount: number
}

/**
 * Cmd+Shift+R agent submission selection. Only local-human comments are
 * selectable (`!author && !github`); AI-agent and GitHub-PR-reviewer comments
 * are never selectable and never reach the submission text. The actual format +
 * PTY write lives in the store's `submitHunkReview`, which re-applies the same
 * exclusion rule via `review-formatter`.
 */
export function useReviewSubmission(opts: {
  annotations: readonly DiffAnnotation[]
}): ReviewSubmissionState {
  const { annotations } = opts
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const submitHunkReview = useAppStore((s) => s.submitHunkReview)

  const selectableIds = useMemo(
    () => new Set(annotations.filter(isSelectableHumanComment).map((a) => a.id)),
    [annotations],
  )

  const toggleComment = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const submit = useCallback(() => {
    // Empty selection submits all human comments (store re-filters); a non-empty
    // selection submits exactly those.
    void submitHunkReview(selectedIds.size > 0 ? selectedIds : undefined)
  }, [submitHunkReview, selectedIds])

  return {
    selectedIds,
    toggleComment,
    submit,
    selectableCount: selectableIds.size,
    selectedCount: selectedIds.size,
  }
}
