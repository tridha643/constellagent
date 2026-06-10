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

  // A programmatically seeded body (suggestion pre-fill) is just set directly;
  // there's no dirty/confirm gate anymore, so no separate pristine baseline.
  const markComposerPristine = useCallback((body: string) => {
    setComposerBody(body)
  }, [])

  // Switching drafts or cancelling discards the current body directly — no confirm
  // modal. Cancel/selection-change is a plain, immediate action (pre-rudu behavior).
  const openDraft = useCallback((target: PatchDraftTarget) => {
    setDraftTarget((current) => {
      if (!draftTargetsEqual(target, current)) setComposerBody('')
      return target
    })
  }, [])

  const onSelectionChange = useCallback(
    (selection: CodeViewLineSelection | null) => {
      if (!selection) {
        setDraftTarget(null)
        setComposerBody('')
        return
      }
      openDraft(selectionToDraft(selection))
    },
    [openDraft],
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
