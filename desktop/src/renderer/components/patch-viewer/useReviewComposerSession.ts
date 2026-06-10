import { useCallback, useRef, useState } from 'react'
import type { CodeViewLineSelection } from '@pierre/diffs'
import { useAppStore } from '../../store/app-store'
import { sendAddToChatText } from '../../utils/add-to-chat'
import { selectionToDraft, draftTargetsEqual, type PatchDraftTarget } from './line-selection'

export interface ReviewComposerSession {
  draftTarget: PatchDraftTarget | null
  /**
   * Read the live draft body. Ref-backed: body keystrokes do NOT re-render this
   * hook's owner — the composer owns its text locally and mirrors it here so the
   * draft survives virtualization unmounts and gates discard decisions.
   */
  getComposerBody: () => string
  setComposerBody: (body: string) => void
  /** Single entry point for selection changes (drag-select, gutter "+", clear). */
  onSelectionChange: (selection: CodeViewLineSelection | null) => void
  /** Explicit user cancel: discard the current draft immediately. */
  onComposerCancel: () => void
  /** Clear after a successful save without running the dirty-draft discard gate. */
  onComposerSaved: () => void
  onAddToChat: (target: PatchDraftTarget) => void
  openDraft: (target: PatchDraftTarget) => void
}

function languageIdFromPath(filePath: string): string {
  return (filePath.split('.').pop() ?? '').toLowerCase()
}

/**
 * Lifted comment-draft state machine. The pending range + body live here (not in
 * CodeView rows, which unmount off-screen) so a draft survives virtualization.
 * Dirty drafts are pinned until the user explicitly cancels or submits; this
 * keeps drag/select events from silently destroying a half-written comment.
 *
 * The body is a ref, NOT state: routing every keystroke through state here
 * re-rendered PatchViewerMain → PatchCodeView → all visible CodeView annotation
 * widgets, making typing/backspace in the composer visibly laggy.
 */
export function useReviewComposerSession(): ReviewComposerSession {
  const [draftTarget, setDraftTarget] = useState<PatchDraftTarget | null>(null)
  const draftTargetRef = useRef<PatchDraftTarget | null>(null)
  const composerBodyRef = useRef('')
  const blockedSelectionToastRef = useRef(0)
  const addToast = useAppStore((s) => s.addToast)

  const setDraftTargetState = useCallback((target: PatchDraftTarget | null) => {
    draftTargetRef.current = target
    setDraftTarget(target)
  }, [])

  const getComposerBody = useCallback(() => composerBodyRef.current, [])

  const setComposerBodyState = useCallback((body: string) => {
    composerBodyRef.current = body
  }, [])

  const canDiscardDraft = useCallback(() => {
    return !composerBodyRef.current.trim()
  }, [])

  const showPinnedDraftToast = useCallback(() => {
    const now = Date.now()
    if (now - blockedSelectionToastRef.current < 1600) return
    blockedSelectionToastRef.current = now
    window.setTimeout(() => {
      addToast({
        id: `review-draft-pinned-${now}`,
        message: 'Finish or cancel the current inline comment before selecting another range.',
        type: 'info',
      })
    }, 0)
  }, [addToast])

  const openDraft = useCallback((target: PatchDraftTarget) => {
    const current = draftTargetRef.current
    // Same target → keep the existing reference; a fresh (but equal) object
    // would rebuild the patch view model for nothing (the gutter "+" release
    // commits the same range twice: onGutterUtilityClick + onLineSelectionEnd).
    if (draftTargetsEqual(target, current)) return
    if (!canDiscardDraft()) {
      showPinnedDraftToast()
      return
    }
    setComposerBodyState('')
    setDraftTargetState(target)
  }, [canDiscardDraft, setComposerBodyState, setDraftTargetState, showPinnedDraftToast])

  const onSelectionChange = useCallback(
    (selection: CodeViewLineSelection | null) => {
      if (!selection) {
        if (!canDiscardDraft()) {
          showPinnedDraftToast()
          return
        }
        setDraftTargetState(null)
        setComposerBodyState('')
        return
      }
      openDraft(selectionToDraft(selection))
    },
    [canDiscardDraft, openDraft, setComposerBodyState, setDraftTargetState, showPinnedDraftToast],
  )

  const onComposerCancel = useCallback(() => {
    setDraftTargetState(null)
    setComposerBodyState('')
  }, [setComposerBodyState, setDraftTargetState])

  const onComposerSaved = useCallback(() => {
    setDraftTargetState(null)
    setComposerBodyState('')
  }, [setComposerBodyState, setDraftTargetState])

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
    getComposerBody,
    setComposerBody: setComposerBodyState,
    onSelectionChange,
    onComposerCancel,
    onComposerSaved,
    onAddToChat,
    openDraft,
  }
}
