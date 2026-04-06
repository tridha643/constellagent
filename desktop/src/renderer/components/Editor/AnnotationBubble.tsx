import { useState, useCallback, useMemo } from 'react'
import {
  annotationLineEnd,
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
  onChanged,
  selected,
  onToggle,
}: {
  annotation: DiffAnnotation
  worktreePath: string
  onChanged: () => void
  selected?: boolean
  onToggle?: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  const handleDelete = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.review.commentRemove(worktreePath, annotation.id)
      onChanged()
    } catch (e) {
      console.error('Review annotation action failed:', e)
      addToast({
        id: `review-comment-err-${Date.now()}`,
        message: annotationErrorMessage(e),
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [busy, worktreePath, annotation.id, onChanged, addToast])

  const handleResolve = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.review.commentResolve(worktreePath, annotation.id, !annotation.resolved)
      onChanged()
    } catch (e) {
      console.error('Review annotation resolve failed:', e)
      addToast({
        id: `review-resolve-err-${Date.now()}`,
        message: annotationErrorMessage(e),
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [busy, worktreePath, annotation.id, annotation.resolved, onChanged, addToast])

  const end = annotationLineEnd(annotation)
  const rangeLabel =
    end !== annotation.lineNumber ? `L${annotation.lineNumber}–L${end}` : `L${annotation.lineNumber}`
  const isAgent = !!annotation.author
  const isGithub = annotation.id.startsWith('PRR') || annotation.id.startsWith('IC_')

  const displayName = isAgent ? annotation.author! : isGithub ? annotation.author! : 'You'
  const initial = displayName.charAt(0).toUpperCase()
  const avatarStyle = useMemo(() => getAvatarStyle(displayName), [displayName])
  const timeAgo = useMemo(() => formatTimeAgo(annotation.createdAt), [annotation.createdAt])

  return (
    <div className={styles.commentBubble} data-annotation-id={annotation.id}>
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
  onCancel,
  onSaved,
}: {
  worktreePath: string
  filePath: string
  side: DiffAnnotationSide
  lineNumber: number
  lineEnd: number
  onCancel: () => void
  onSaved: () => void
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  const submit = async () => {
    const trimmed = body.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const opts: Parameters<typeof window.api.review.commentAdd>[4] = {
        ...(side === 'deletions' ? { oldLine: lineNumber } : {}),
        ...(lineEnd > lineNumber ? { lineEnd } : {}),
        force: true,
      }
      await window.api.review.commentAdd(worktreePath, filePath, lineNumber, trimmed, opts)
      setBody('')
      onSaved()
    } catch (e) {
      console.error('Failed to add review annotation:', e)
      addToast({
        id: `review-comment-err-${Date.now()}`,
        message: annotationErrorMessage(e),
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const sideLabel = side === 'additions' ? 'New' : 'Old'
  const lineLabel =
    lineEnd > lineNumber ? `lines ${lineNumber}–${lineEnd}` : `line ${lineNumber}`

  return (
    <div className={styles.composerBubble} data-diff-annotation-composer>
      <div className={styles.composerLabel}>
        Comment on {sideLabel} {lineLabel}
      </div>
      <textarea
        className={styles.composerTextarea}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment..."
        autoFocus
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
        <span className={styles.composerHint}>&#8984;Enter to submit</span>
      </div>
    </div>
  )
}

export function HunkActionAnnotation({
  hunkIndex,
  onAccept,
  onReject,
}: {
  hunkIndex: number
  onAccept: (hunkIndex: number) => void
  onReject: (hunkIndex: number) => void
}) {
  return (
    <div className={styles.hunkActionBar}>
      <div className={styles.hunkActionGroup}>
        <button
          type="button"
          onClick={() => onReject(hunkIndex)}
          className={styles.hunkActionUndo}
        >
          Undo <kbd className={styles.kbd}>&#8984;N</kbd>
        </button>
        <button
          type="button"
          onClick={() => onAccept(hunkIndex)}
          className={styles.hunkActionKeep}
        >
          Keep <kbd className={styles.kbd}>&#8984;Y</kbd>
        </button>
      </div>
    </div>
  )
}
