import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotationPatch, DiffAnnotation, DiffAnnotationSide } from '@shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import { modShortcutHintLabel, reviewAnnotationErrorMessage } from './review-attribution'
import styles from '../Editor/AnnotationBubble.module.css'

/**
 * Rudu-shaped comment composer wired to our libSQL backend. Faithful clone of
 * rudu's `review-comment-composer` affordances: markdown textarea, a
 * suggestion mode that wraps the seed in a ```suggestion fence, a
 * selected-line label, and a secondary action repurposed from rudu's "Add to
 * Rudu" to our "Add to Chat" (attach the line range to the agent thread).
 *
 * Optimistic insert + `window.api.review.commentAdd` are preserved verbatim from
 * the retired `CommentComposer`.
 */
export function ReviewCommentComposer({
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
  allowSuggestion = false,
  suggestionSeed = '',
  suggestionLanguage = '',
  selectedLineLabel,
  onAddToChat,
  onSeedPristine,
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
  onDirtyChange?: (dirty: boolean) => void
  allowSuggestion?: boolean
  suggestionSeed?: string
  suggestionLanguage?: string
  selectedLineLabel?: string
  onAddToChat?: () => void
  /** Records a seeded body as the pristine baseline (no spurious dirty/discard). */
  onSeedPristine?: (body: string) => void
}) {
  const [internalBody, setInternalBody] = useState('')
  const body = bodyProp ?? internalBody
  const setBody = useCallback((next: string) => {
    if (onBodyChange) onBodyChange(next)
    else setInternalBody(next)
  }, [onBodyChange])
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    onDirtyChange?.(body.trim().length > 0)
  }, [body, onDirtyChange])

  const suggestionBlock = useCallback(
    () => {
      const fence = suggestionLanguage ? `suggestion ${suggestionLanguage}` : 'suggestion'
      return `\`\`\`${fence}\n${suggestionSeed}\n\`\`\`\n`
    },
    [suggestionSeed, suggestionLanguage],
  )

  // Multi-line selection → grab the selected code into the composer as a
  // ```suggestion block (rudu's seed). Runs once per draft mount (the composer
  // is keyed per draft target). Recorded as pristine so it isn't a dirty draft.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    if (!suggestionSeed || lineEnd <= lineNumber) return
    if (body.trim().length > 0) return
    seededRef.current = true
    const seeded = suggestionBlock()
    setSuggesting(true)
    if (onSeedPristine) onSeedPristine(seeded)
    else setBody(seeded)
  }, [suggestionSeed, lineEnd, lineNumber, body, suggestionBlock, onSeedPristine, setBody])

  const toggleSuggestion = useCallback(() => {
    setSuggesting((prev) => {
      const next = !prev
      if (next && body.trim().length === 0) setBody(suggestionBlock())
      return next
    })
  }, [body, setBody, suggestionBlock])

  const submit = async () => {
    const trimmed = body.trim()
    if (!trimmed || busy) return
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
      addToast({ id: `review-comment-err-${Date.now()}`, message: reviewAnnotationErrorMessage(e), type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const sideShort = side === 'additions' ? 'New' : 'Old'
  const linePillText =
    selectedLineLabel ?? (lineEnd > lineNumber ? `Lines ${lineNumber}–${lineEnd}` : `Line ${lineEnd}`)
  const mod = modShortcutHintLabel()

  return (
    <div className={styles.composerBubble} data-diff-annotation-composer>
      <div className={styles.composerHeader}>
        <span className={styles.composerTitle}>{suggesting ? 'Suggest a change' : 'New comment'}</span>
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
        placeholder={suggesting ? 'Propose replacement code…' : 'Leave a comment…'}
        autoFocus
        rows={suggesting ? 5 : 3}
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
        <button type="button" onClick={onCancel} className={styles.composerCancel}>
          Cancel
        </button>
        {allowSuggestion && (
          <button
            type="button"
            onClick={toggleSuggestion}
            className={styles.composerCancel}
            aria-pressed={suggesting}
          >
            {suggesting ? 'Plain comment' : 'Suggest'}
          </button>
        )}
        {onAddToChat && (
          <button type="button" onClick={onAddToChat} className={styles.composerCancel}>
            Add to Chat
          </button>
        )}
        <span className={styles.composerHint}>{mod}+Enter to submit</span>
      </div>
    </div>
  )
}
