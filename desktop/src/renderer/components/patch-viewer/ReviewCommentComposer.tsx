import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bold,
  Code,
  Heading3,
  Italic,
  Lightbulb,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  SquareCode,
  Strikethrough,
} from 'lucide-react'
import type { Command, EditorView } from '@codemirror/view'
import type { AnnotationPatch, DiffAnnotation, DiffAnnotationSide } from '@shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import {
  insertLink,
  toggleEmphasis,
  toggleInlineCode,
  toggleStrikethrough,
  toggleStrongEmphasis,
} from '../../lib/prosemark/markdownFormattingKeymap'
import {
  insertCodeBlock,
  toggleBulletList,
  toggleHeading,
  toggleOrderedList,
  toggleQuote,
  toggleSuggestionBlock,
  toggleTaskList,
} from './markdownBlockCommands'
import { MarkdownComposerEditor } from './MarkdownComposerEditor'
import { modShortcutHintLabel, reviewAnnotationErrorMessage } from './review-attribution'
import styles from '../Editor/AnnotationBubble.module.css'

type ToolbarIcon = typeof Bold

interface ToolbarAction {
  key: string
  label: string
  icon: ToolbarIcon
  command: Command
}

const INLINE_ACTIONS: ToolbarAction[] = [
  { key: 'bold', label: 'Bold', icon: Bold, command: toggleStrongEmphasis },
  { key: 'italic', label: 'Italic', icon: Italic, command: toggleEmphasis },
  { key: 'strikethrough', label: 'Strikethrough', icon: Strikethrough, command: toggleStrikethrough },
  { key: 'code', label: 'Inline code', icon: Code, command: toggleInlineCode },
  { key: 'codeblock', label: 'Code block', icon: SquareCode, command: insertCodeBlock },
  { key: 'quote', label: 'Quote', icon: Quote, command: toggleQuote },
  { key: 'bullet', label: 'Bulleted list', icon: List, command: toggleBulletList },
  { key: 'numbered', label: 'Numbered list', icon: ListOrdered, command: toggleOrderedList },
  { key: 'task', label: 'Task list', icon: ListTodo, command: toggleTaskList },
  { key: 'heading', label: 'Heading', icon: Heading3, command: toggleHeading },
  { key: 'link', label: 'Link', icon: LinkIcon, command: insertLink },
]

/** rudu-style formatting toolbar; each button runs a CodeMirror command on the editor. */
function FormattingToolbar({
  onRun,
  busy,
  allowSuggestion,
  suggestionSeed,
  suggestionActive,
}: {
  onRun: (command: Command) => void
  busy: boolean
  allowSuggestion: boolean
  suggestionSeed: string
  suggestionActive: boolean
}) {
  return (
    <div className={styles.composerToolbar} role="toolbar" aria-label="Formatting">
      {INLINE_ACTIONS.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.key}
            type="button"
            className={styles.composerToolbarBtn}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRun(action.command)}
            disabled={busy}
            title={action.label}
            aria-label={action.label}
            data-testid={`composer-format-${action.key}`}
          >
            <Icon size={14} strokeWidth={2} aria-hidden />
          </button>
        )
      })}
      {allowSuggestion && (
        <button
          type="button"
          className={styles.composerToolbarBtn}
          data-active={suggestionActive || undefined}
          aria-pressed={suggestionActive}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onRun(toggleSuggestionBlock(suggestionSeed))}
          disabled={busy}
          title={suggestionActive ? 'Remove suggestion block' : 'Suggest a change'}
          aria-label={suggestionActive ? 'Remove suggestion block' : 'Suggest a change'}
          data-testid="composer-format-suggestion"
        >
          <Lightbulb size={14} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * Rudu-shaped comment composer wired to our libSQL backend, built on the in-repo
 * prosemark / CodeMirror 6 stack. A formatting toolbar + syntax-highlighted
 * markdown editor (`MarkdownComposerEditor`) replace the old monospace textarea;
 * the suggestion affordance is an explicit toolbar toggle: it inserts a
 * ```suggestion fence seeded with the selected diff lines (never auto-filled on
 * selection), and pressing it again removes the block.
 *
 * The body is **local state** initialized from `initialBody`; every change is
 * mirrored to `onBodyChange` (a ref write upstream). Keystrokes therefore never
 * re-render the patch viewer tree — only this composer — while the draft still
 * survives virtualization unmounts via the session ref.
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
  initialBody = '',
  onBodyChange,
  onCancel,
  onSaved,
  onApply,
  onDirtyChange,
  allowSuggestion = false,
  suggestionSeed = '',
  selectedLineLabel,
  onAddToChat,
}: {
  worktreePath: string
  filePath: string
  side: DiffAnnotationSide
  lineNumber: number
  lineEnd: number
  /** Body to restore on mount (e.g. after a virtualization unmount/remount). */
  initialBody?: string
  /** Mirror of every body change; the session stores it in a ref. */
  onBodyChange?: (body: string) => void
  onCancel: () => void
  onSaved: () => void
  onApply: (patch: AnnotationPatch) => void
  onDirtyChange?: (dirty: boolean) => void
  allowSuggestion?: boolean
  suggestionSeed?: string
  selectedLineLabel?: string
  onAddToChat?: () => void
}) {
  const [body, setBodyState] = useState(initialBody)
  const setBody = useCallback((next: string) => {
    setBodyState(next)
    onBodyChange?.(next)
  }, [onBodyChange])
  const [busy, setBusy] = useState(false)
  const viewRef = useRef<EditorView | null>(null)
  const addToast = useAppStore((s) => s.addToast)

  // Header label is derived from the body rather than a standalone toggle: once a
  // ```suggestion fence exists, this reads as a change suggestion.
  const isSuggestion = body.includes('```suggestion')

  useEffect(() => {
    onDirtyChange?.(body.trim().length > 0)
  }, [body, onDirtyChange])

  const runCommand = useCallback(
    (command: Command) => {
      const view = viewRef.current
      if (!view || busy) return
      command(view)
      view.focus()
    },
    [busy],
  )

  const submit = useCallback(async () => {
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
  }, [body, busy, filePath, side, lineNumber, lineEnd, onApply, setBody, onSaved, worktreePath, addToast])

  const sideShort = side === 'additions' ? 'New' : 'Old'
  const linePillText =
    selectedLineLabel ?? (lineEnd > lineNumber ? `Lines ${lineNumber}–${lineEnd}` : `Line ${lineEnd}`)
  const mod = modShortcutHintLabel()

  return (
    <div className={styles.composerBubble} data-diff-annotation-composer>
      <div className={styles.composerHeader}>
        <span
          key={isSuggestion ? 'suggest' : 'comment'}
          className={styles.composerTitle}
        >
          {isSuggestion ? 'Suggest a change' : 'New comment'}
        </span>
        <div className={styles.composerLineMeta}>
          <span className={styles.linePill}>{linePillText}</span>
          <span className={styles.sidePill}>{sideShort}</span>
        </div>
      </div>
      <div className={styles.composerEditorWrap}>
        <FormattingToolbar
          onRun={runCommand}
          busy={busy}
          allowSuggestion={allowSuggestion}
          suggestionSeed={suggestionSeed}
          suggestionActive={isSuggestion}
        />
        <MarkdownComposerEditor
          value={body}
          onChange={setBody}
          onSubmit={() => void submit()}
          onCancel={onCancel}
          autoFocus
          readOnly={busy}
          placeholder={isSuggestion ? 'Propose replacement code…' : 'Leave a comment…'}
          onViewReady={(view) => {
            viewRef.current = view
          }}
        />
      </div>
      <div className={styles.composerActions}>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !body.trim()}
          className={styles.composerSubmit}
        >
          {isSuggestion ? 'Suggest' : 'Comment'}
          <span className={styles.composerSubmitChip} aria-hidden>
            {mod}↵
          </span>
        </button>
        <button type="button" onClick={onCancel} className={styles.composerCancel}>
          Cancel
        </button>
        {onAddToChat && (
          <button type="button" onClick={onAddToChat} className={styles.composerCancel}>
            Add to Chat
          </button>
        )}
      </div>
    </div>
  )
}
