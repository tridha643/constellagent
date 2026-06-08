import { useCallback, useMemo, useState } from 'react'
import {
  annotationLineEnd,
  type AnnotationPatch,
  type DiffAnnotation,
} from '@shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import { classifyReviewer } from './review-threads'
import {
  formatTimeAgo,
  getAvatarStyle,
  reviewAnnotationErrorMessage,
  reviewerDisplayName,
} from './review-attribution'
import styles from '../Editor/AnnotationBubble.module.css'

/**
 * One attributed comment card in a multi-reviewer thread. Local-human cards are
 * editable (resolve/delete) and selectable for Cmd+Shift+R; AI-agent and
 * GitHub-PR-reviewer cards are read-only "other reviewer" context. Backend wiring
 * (optimistic resolve/remove via `window.api.review`) is preserved verbatim from
 * the retired `CommentBubble`.
 */
export function ReviewCommentCard({
  annotation,
  worktreePath,
  onApply,
  tourState = 'off',
  selected,
  onToggle,
}: {
  annotation: DiffAnnotation
  worktreePath: string
  onApply: (patch: AnnotationPatch) => void
  tourState?: 'off' | 'active' | 'inactive'
  selected?: boolean
  onToggle?: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  const handleDelete = useCallback(async () => {
    if (busy) return
    const snapshot = annotation
    setBusy(true)
    onApply({ type: 'remove', id: annotation.id })
    try {
      await window.api.review.commentRemove(worktreePath, annotation.id)
    } catch (e) {
      console.error('Review annotation action failed:', e)
      onApply({ type: 'rollback-restore', annotation: snapshot })
      addToast({ id: `review-comment-err-${Date.now()}`, message: reviewAnnotationErrorMessage(e), type: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, worktreePath, annotation, onApply, addToast])

  const handleResolve = useCallback(async () => {
    if (busy) return
    const previousResolved = annotation.resolved
    setBusy(true)
    onApply({ type: 'update', id: annotation.id, changes: { resolved: !previousResolved } })
    try {
      await window.api.review.commentResolve(worktreePath, annotation.id, !previousResolved)
    } catch (e) {
      console.error('Review annotation resolve failed:', e)
      onApply({ type: 'update', id: annotation.id, changes: { resolved: previousResolved } })
      addToast({ id: `review-resolve-err-${Date.now()}`, message: reviewAnnotationErrorMessage(e), type: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, worktreePath, annotation.id, annotation.resolved, onApply, addToast])

  const end = annotationLineEnd(annotation)
  const rangeLabel =
    end !== annotation.lineNumber ? `L${annotation.lineNumber}–L${end}` : `L${annotation.lineNumber}`
  const sideShort = annotation.side === 'additions' ? 'New' : 'Old'
  const reviewerKind = classifyReviewer(annotation)
  const isAgent = reviewerKind === 'ai-agent'
  const isGithub = reviewerKind === 'github'
  const isHuman = reviewerKind === 'local-human'

  const displayName = reviewerDisplayName(annotation)
  const initial = displayName.charAt(0).toUpperCase()
  const avatarStyle = useMemo(() => getAvatarStyle(displayName), [displayName])
  const timeAgo = useMemo(() => formatTimeAgo(annotation.createdAt), [annotation.createdAt])
  const showTourDetails = tourState === 'active' && !!annotation.rationale

  return (
    <div
      className={[
        styles.commentBubble,
        tourState === 'active' ? styles.commentBubbleTourActive : '',
        tourState === 'inactive' ? styles.commentBubbleTourInactive : '',
      ].filter(Boolean).join(' ')}
      data-annotation-id={annotation.id}
      data-reviewer-kind={reviewerKind}
    >
      <div className={styles.commentLocationRow}>
        <span className={styles.linePill}>{rangeLabel}</span>
        <span className={styles.sidePill}>{sideShort}</span>
      </div>
      <div className={styles.commentThread}>
        <div className={styles.avatar} style={{ backgroundColor: avatarStyle.bg, color: avatarStyle.text }}>
          {initial}
        </div>
        <div className={styles.commentContent}>
          <div className={styles.commentMeta}>
            <span className={styles.authorName} style={{ color: avatarStyle.text }}>
              {displayName}
            </span>
            {timeAgo && <span className={styles.timestamp}>{timeAgo}</span>}
            {tourState === 'active' && isAgent && <span className={styles.tourStepPill}>Code Tour</span>}
            {isGithub && <span className={styles.resolvedPill}>Reviewer</span>}
            {annotation.resolved && <span className={styles.resolvedPill}>Resolved</span>}
            {isHuman && onToggle && (
              <input
                type="checkbox"
                checked={!!selected}
                onChange={() => onToggle(annotation.id)}
                className={styles.commentCheckbox}
              />
            )}
          </div>
          <p className={styles.commentBody}>{annotation.body}</p>
          {showTourDetails && <p className={styles.commentRationale}>{annotation.rationale}</p>}
          {!isGithub && !isAgent && (
            <div className={styles.commentActions}>
              <button
                type="button"
                onClick={() => void handleResolve()}
                disabled={busy}
                className={`${styles.commentActionBtn} ${annotation.resolved ? styles.unresolve : styles.resolve}`}
              >
                {annotation.resolved ? 'Unresolve' : 'Resolve'}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy}
                className={`${styles.commentActionBtn} ${styles.delete}`}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
