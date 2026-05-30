/** Textarea-shaped ref for the composer contenteditable (slash/@ menus set selection by offset). */
export interface ComposerDraftInputRef {
  focus(): void
  readonly selectionStart: number
  readonly selectionEnd: number
  setSelectionRange(start: number, end: number): void
  updateSelection(start: number, end: number): void
}

export type ComposerDraftInputRefImpl = ComposerDraftInputRef & {
  attach: (el: HTMLElement | null, applyCaret: () => void) => void
  /** Caret to apply after the next DOM rebuild (slash/@ insert). */
  consumePendingCaret: () => number | null
}

export function createComposerDraftInputRef(): ComposerDraftInputRefImpl {
  let el: HTMLElement | null = null
  let applyCaret: (() => void) | null = null
  let selectionStart = 0
  let selectionEnd = 0
  let pendingCaret: number | null = null

  const scheduleCaret = (start: number, end: number) => {
    selectionStart = start
    selectionEnd = end
    pendingCaret = start
    applyCaret?.()
  }

  return {
    attach(nextEl, nextApplyCaret) {
      el = nextEl
      applyCaret = nextApplyCaret
    },
    focus() {
      el?.focus()
    },
    get selectionStart() {
      return selectionStart
    },
    get selectionEnd() {
      return selectionEnd
    },
    set selectionStart(start: number) {
      scheduleCaret(start, start)
    },
    set selectionEnd(end: number) {
      scheduleCaret(selectionStart, end)
    },
    setSelectionRange(start, end) {
      scheduleCaret(start, end)
    },
    updateSelection(start, end) {
      selectionStart = start
      selectionEnd = end
    },
    consumePendingCaret() {
      const pos = pendingCaret
      pendingCaret = null
      return pos
    },
  }
}
