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
      await window.api.hunk.commentRemove(worktreePath, annotation.id)
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
  }, [busy, worktreePath, annotation.id, onChanged, addToast])

  const end = annotationLineEnd(annotation)
  const rangeLabel =
    end !== annotation.lineNumber ? `L${annotation.lineNumber}–L${end}` : `L${annotation.lineNumber}`
  const isAgent = !!annotation.author
  const isGithub = annotation.id.startsWith('PRR') || annotation.id.startsWith('IC_')

  return (
    <div
      className="rounded-lg border border-white/10 bg-white/[0.03] p-4 shadow-sm"
      style={{ whiteSpace: 'normal', fontFamily: 'var(--font-sans)' }}
      data-annotation-id={annotation.id}
    >
      <div className="flex items-baseline gap-2">
        <span className={`text-sm font-semibold ${isAgent ? 'text-purple-400' : isGithub ? 'text-orange-400' : 'text-gray-300'}`}>
          {isAgent ? annotation.author : isGithub ? annotation.author : 'You'}
        </span>
        <span className="text-xs text-gray-500 font-mono">{rangeLabel}</span>
        {annotation.resolved && (
          <span className="text-xs text-green-500 font-mono">Resolved</span>
        )}
        {!isAgent && !isGithub && onToggle && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggle(annotation.id)}
            className="ml-auto h-3.5 w-3.5 accent-blue-500 cursor-pointer"
          />
        )}
      </div>
      <p className="mt-1 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
        {annotation.body}
      </p>
      {!isGithub && (
        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
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
    <div
      className="rounded-lg border border-white/10 bg-white/[0.03] p-4 shadow-sm"
      style={{ whiteSpace: 'normal', fontFamily: 'var(--font-sans)' }}
      data-diff-annotation-composer
    >
      <div className="text-xs text-gray-500 font-mono mb-2">
        Comment on {sideLabel} {lineLabel}
      </div>
      <textarea
        className="w-full min-h-[60px] resize-none rounded-md border border-white/10 bg-black/40 p-2 text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !body.trim()}
          className="rounded-md bg-blue-500 px-3 py-1 text-xs text-white cursor-pointer disabled:opacity-50"
        >
          Comment
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-xs text-gray-400 hover:text-gray-300 cursor-pointer"
        >
          Cancel
        </button>
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
    <div style={{ position: 'relative', zIndex: 10, width: '100%', overflow: 'visible' }}>
      <div
        className="absolute top-1 right-8 flex gap-1"
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        <button
          type="button"
          onClick={() => onReject(hunkIndex)}
          className="rounded-[4px] bg-white/10 px-2 py-0.5 text-xs text-gray-300 hover:bg-white/15 transition-colors cursor-pointer"
        >
          Undo <span className="-ml-0.5 font-normal opacity-80">N</span>
        </button>
        <button
          type="button"
          onClick={() => onAccept(hunkIndex)}
          className="rounded-[4px] bg-green-500/80 px-2 py-0.5 text-xs text-black hover:bg-green-500 transition-colors cursor-pointer"
        >
          Keep <span className="-ml-0.5 font-normal opacity-40">Y</span>
        </button>
      </div>
    </div>
  )
}
