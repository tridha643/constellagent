import { useCallback, useState } from 'react'
import type { CodeViewLineSelection } from '@pierre/diffs'
import { sendAddToChatText } from '../../utils/add-to-chat'
import { selectionToDraft, draftTargetsEqual, type PatchDraftTarget } from './line-selection'

export interface ReviewComposerSession {
  draftTarget: PatchDraftTarget | null
  composerBody: string
  setComposerBody: (body: string) => void
  /**
   * Record a programmatically seeded body (e.g. a ```suggestion pre-fill) as the
   * pristine baseline so an untouched seed isn't treated as a dirty draft (no
   * spurious discard prompt when re-selecting).
   */
  markComposerPristine: (body: string) => void
  /** Single entry point for selection changes (drag-select, gutter "+", clear). */
  onSelectionChange: (selection: CodeViewLineSelection | null) => void
  onAddToChat: (target: PatchDraftTarget) => void
  openDraft: (target: PatchDraftTarget) => void
}

function languageIdFromPath(filePath: string): string {
  return (filePath.split('.').pop() ?? '').toLowerCase()
}

/**
 * Lifted comment-draft state machine. The pending range + body live here (not in
 * CodeView rows, which unmount off-screen) so a draft survives virtualization.
 * Mirrors the retired DiffFileSection dirty-discard confirm, adapted to CodeView's
 * single global controlled selection.
 */
export function useReviewComposerSession(): ReviewComposerSession {
  const [draftTarget, setDraftTarget] = useState<PatchDraftTarget | null>(null)
  const [composerBody, setComposerBody] = useState('')
  // Programmatically seeded baseline (suggestion pre-fill). A body equal to this
  // is "pristine" — the user hasn't typed, so switching drafts needs no confirm.
  const [pristineBody, setPristineBody] = useState('')

  const isDirty = composerBody.trim().length > 0 && composerBody !== pristineBody

  const markComposerPristine = useCallback((body: string) => {
    setComposerBody(body)
    setPristineBody(body)
  }, [])

  const openDraft = useCallback(
    (target: PatchDraftTarget) => {
      setDraftTarget((current) => {
        if (current && isDirty && !draftTargetsEqual(target, current)) {
          if (!window.confirm('Discard your comment draft?')) return current
        }
        if (!draftTargetsEqual(target, current)) {
          setComposerBody('')
          setPristineBody('')
        }
        return target
      })
    },
    [isDirty],
  )

  const onSelectionChange = useCallback(
    (selection: CodeViewLineSelection | null) => {
      if (!selection) {
        if (isDirty) {
          if (!window.confirm('Discard your comment draft?')) return
        }
        setDraftTarget(null)
        setComposerBody('')
        setPristineBody('')
        return
      }
      openDraft(selectionToDraft(selection))
    },
    [isDirty, openDraft],
  )

  const onAddToChat = useCallback((target: PatchDraftTarget) => {
    const filePath = target.filePath
    const rangeLabel =
      target.lineEnd > target.lineNumber
        ? `lines ${target.lineNumber}–${target.lineEnd}`
        : `line ${target.lineNumber}`
    const reference = `Re: \`${filePath}\` ${rangeLabel} (${target.side === 'additions' ? 'new' : 'old'} side)`
    sendAddToChatText(filePath, languageIdFromPath(filePath), reference)
  }, [])

  return {
    draftTarget,
    composerBody,
    setComposerBody,
    markComposerPristine,
    onSelectionChange,
    onAddToChat,
    openDraft,
  }
}
