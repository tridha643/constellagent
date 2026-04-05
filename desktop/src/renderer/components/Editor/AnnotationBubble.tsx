import { useState, useCallback } from 'react'
import {
  annotationLineEnd,
  type DiffAnnotation,
  type DiffAnnotationSide,
} from '../../../shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import styles from './AnnotationBubble.module.css'

function hunkCliMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.match(/hunk:\s*[^\n]+/)
  return m ? m[0] : raw.split('\n')[0] ?? 'Hunk comment action failed'
}

export function AnnotationBubble({
  annotation,
  worktreePath,
  onChanged,
}: {
  annotation: DiffAnnotation
  worktreePath: string
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      try {
        await fn()
        onChanged()
      } catch (e) {
        console.error('Hunk comment action failed:', e)
        addToast({
          id: `hunk-comment-err-${Date.now()}`,
          message: hunkCliMessage(e),
          type: 'error',
        })
      } finally {
        setBusy(false)
      }
    },
    [onChanged, addToast],
  )

  const end = annotationLineEnd(annotation)
  const rangeLabel =
    end !== annotation.lineNumber ? `L${annotation.lineNumber}–L${end}` : `L${annotation.lineNumber}`
  const isAgent = !!annotation.author

  return (
    <div
      className={`${styles.bubble} ${isAgent ? styles.bubbleAgent : ''} ${annotation.resolved ? styles.bubbleResolved : ''}`}
      data-annotation-id={annotation.id}
    >
      <div className={styles.meta}>
        <span>
          {isAgent && <span className={styles.authorLabel}>AI</span>}
          {annotation.resolved ? `Resolved · ${rangeLabel}` : rangeLabel}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            disabled={busy}
            onClick={() => run(() => window.api.hunk.commentRemove(worktreePath, annotation.id))}
          >
            Delete
          </button>
        </div>
      </div>
      <div className={styles.body}>{annotation.body}</div>
    </div>
  )
}

export function AnnotationComposer({
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
      const opts = side === 'deletions' ? { oldLine: lineNumber } : undefined
      await window.api.hunk.commentAdd(worktreePath, filePath, lineNumber, trimmed, opts)
      setBody('')
      onSaved()
    } catch (e) {
      console.error('Failed to add hunk comment:', e)
      addToast({
        id: `hunk-comment-err-${Date.now()}`,
        message: hunkCliMessage(e),
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
    <div className={styles.composer} data-diff-annotation-composer>
      <div className={styles.composerLabel}>
        Comment on {sideLabel} {lineLabel}
      </div>
      <textarea
        className={styles.textarea}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Review note…"
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
        <button type="button" className={styles.composerBtn} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.composerBtn} ${styles.composerBtnPrimary}`}
          disabled={busy || !body.trim()}
          onClick={() => void submit()}
        >
          Add comment
        </button>
      </div>
    </div>
  )
}
