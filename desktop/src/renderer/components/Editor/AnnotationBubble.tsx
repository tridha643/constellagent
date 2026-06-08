import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  annotationLineEnd,
  type AnnotationPatch,
  type DiffAnnotation,
  type DiffAnnotationSide,
} from '../../../shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import styles from './AnnotationBubble.module.css'

function annotationErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.split('\n')[0] ?? 'Review annotation action failed'
}

const AVATAR_COLORS: Record<string, { bg: string; text: string }> = {
  you: { bg: 'rgba(59, 130, 246, 0.2)', text: 'rgb(147, 197, 253)' },
  cursor: { bg: 'rgba(168, 85, 247, 0.2)', text: 'rgb(192, 132, 252)' },
  'claude-code': { bg: 'rgba(251, 146, 60, 0.2)', text: 'rgb(253, 186, 116)' },
  codex: { bg: 'rgba(52, 211, 153, 0.2)', text: 'rgb(110, 231, 183)' },
  gemini: { bg: 'rgba(56, 189, 248, 0.2)', text: 'rgb(125, 211, 252)' },
}

function getAvatarStyle(name: string) {
  const key = name.toLowerCase()
  if (AVATAR_COLORS[key]) return AVATAR_COLORS[key]
  const hash = key.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const hue = hash % 360
  return { bg: `hsla(${hue}, 60%, 50%, 0.2)`, text: `hsl(${hue}, 70%, 75%)` }
}

function modShortcutHintLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl'
}

function formatTimeAgo(isoDate: string): string {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

export function CommentBubble({
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

  // Optimistic remove: drop the row locally first; restore on IPC failure.
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
      addToast({
        id: `review-comment-err-${Date.now()}`,
        message: annotationErrorMessage(e),
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [busy, worktreePath, annotation, onApply, addToast])

  // Optimistic resolve toggle: flip locally, revert on IPC failure.
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
      addToast({
        id: `review-resolve-err-${Date.now()}`,
        message: annotationErrorMessage(e),
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [busy, worktreePath, annotation.id, annotation.resolved, onApply, addToast])

  const end = annotationLineEnd(annotation)
  const rangeLabel =
    end !== annotation.lineNumber ? `L${annotation.lineNumber}–L${end}` : `L${annotation.lineNumber}`
  const sideShort = annotation.side === 'additions' ? 'New' : 'Old'
  const isAgent = !!annotation.author
  const isGithub = annotation.id.startsWith('PRR') || annotation.id.startsWith('IC_')

  const displayName = isAgent ? annotation.author! : isGithub ? annotation.author! : 'You'
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
    >
      <div className={styles.commentLocationRow}>
        <span className={styles.linePill}>{rangeLabel}</span>
        <span className={styles.sidePill}>{sideShort}</span>
      </div>
      <div className={styles.commentThread}>
        <div
          className={styles.avatar}
          style={{ backgroundColor: avatarStyle.bg, color: avatarStyle.text }}
        >
          {initial}
        </div>
        <div className={styles.commentContent}>
          <div className={styles.commentMeta}>
            <span className={styles.authorName} style={{ color: avatarStyle.text }}>
              {displayName}
            </span>
            {timeAgo && <span className={styles.timestamp}>{timeAgo}</span>}
            {tourState === 'active' && isAgent && (
              <span className={styles.tourStepPill}>Code Tour</span>
            )}
            {annotation.resolved && <span className={styles.resolvedPill}>Resolved</span>}
            {!isAgent && !isGithub && onToggle && (
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
          {!isGithub && (
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

export function CommentComposer({
  worktreePath,
  filePath,
  side,
  lineNumber,
  lineEnd,
  body: bodyProp,
  onBodyChange,
  onCancel,
  onSaved,
  onApply,
  onDirtyChange,
}: {
  worktreePath: string
  filePath: string
  side: DiffAnnotationSide
  lineNumber: number
  lineEnd: number
  body?: string
  onBodyChange?: (body: string) => void
  onCancel: () => void
  onSaved: () => void
  onApply: (patch: AnnotationPatch) => void
  /** Fires when non-whitespace content differs from empty (draft state). */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [internalBody, setInternalBody] = useState('')
  const body = bodyProp ?? internalBody
  const setBody = useCallback((next: string) => {
    if (onBodyChange) onBodyChange(next)
    else setInternalBody(next)
  }, [onBodyChange])
  const [busy, setBusy] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    onDirtyChange?.(body.trim().length > 0)
  }, [body, onDirtyChange])

  const submit = async () => {
    const trimmed = body.trim()
    if (!trimmed || busy) return
    // Generate the id client-side and pass it through so the DB row shares the
    // same id as the optimistic in-memory row. Avoids a temp-id swap that
    // would remount every consumer keyed by id.
    const id = crypto.randomUUID()
    const optimistic: DiffAnnotation = {
      id,
      filePath,
      side,
      lineNumber,
      lineEnd: lineEnd > lineNumber ? lineEnd : undefined,
      body: trimmed,
      createdAt: new Date().toISOString(),
      resolved: false,
    }
    setBusy(true)
    onApply({ type: 'insert', annotation: optimistic })
    setBody('')
    onSaved()
    try {
      const opts: Parameters<typeof window.api.review.commentAdd>[4] = {
        id,
        ...(side === 'deletions' ? { oldLine: lineNumber } : {}),
        ...(lineEnd > lineNumber ? { lineEnd } : {}),
        force: true,
      }
      await window.api.review.commentAdd(worktreePath, filePath, lineNumber, trimmed, opts)
    } catch (e) {
      console.error('Failed to add review annotation:', e)
      onApply({ type: 'rollback-insert', id })
      addToast({
        id: `review-comment-err-${Date.now()}`,
        message: annotationErrorMessage(e),
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const sideShort = side === 'additions' ? 'New' : 'Old'
  const linePillText =
    lineEnd > lineNumber ? `Lines ${lineNumber}–${lineEnd}` : `Line ${lineEnd}`
  const mod = modShortcutHintLabel()

  return (
    <div className={styles.composerBubble} data-diff-annotation-composer>
      <div className={styles.composerHeader}>
        <span className={styles.composerTitle}>New comment</span>
        <div className={styles.composerLineMeta}>
          <span className={styles.linePill}>{linePillText}</span>
          <span className={styles.sidePill}>{sideShort}</span>
        </div>
      </div>
      <textarea
        data-testid="diff-comment-composer-textarea"
        className={styles.composerTextarea}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment…"
        autoFocus
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className={styles.composerActions}>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !body.trim()}
          className={styles.composerSubmit}
        >
          Comment
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={styles.composerCancel}
        >
          Cancel
        </button>
        <span className={styles.composerHint}>
          {mod}+Enter to submit
        </span>
      </div>
    </div>
  )
}

export function HunkActionAnnotation({
  hunkIndex,
  onAccept,
  onReject,
  disabled = false,
}: {
  hunkIndex: number
  onAccept: (hunkIndex: number) => void
  onReject: (hunkIndex: number) => void
  disabled?: boolean
}) {
  return (
    <div className={styles.hunkActionBar}>
      <div className={styles.hunkActionGroup}>
        <button
          type="button"
          aria-label="Undo hunk"
          disabled={disabled}
          onClick={() => onReject(hunkIndex)}
          className={styles.hunkActionUndo}
        >
          Undo <kbd className={styles.kbd}>&#8984;N</kbd>
        </button>
        <button
          type="button"
          aria-label="Keep hunk"
          disabled={disabled}
          onClick={() => onAccept(hunkIndex)}
          className={styles.hunkActionKeep}
        >
          Keep <kbd className={styles.kbd}>&#8984;Y</kbd>
        </button>
      </div>
    </div>
  )
}
