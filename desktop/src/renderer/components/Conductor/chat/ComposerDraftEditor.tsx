import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import {
  autoGrowComposerEditor,
  composerDraftDomMatchesText,
  ensureComposerEditableTail,
  getComposerEditorCaretOffset,
  hydrateComposerDraftChipIcons,
  renderComposerEditor,
  serializeComposerEditor,
  setComposerEditorCaretOffset,
} from './composer-draft-editor-dom'
import type { ComposerDraftInputRef, ComposerDraftInputRefImpl } from './composer-draft-input-ref'
import { useAppStore } from '../../../store/app-store'
import styles from '../Conductor.module.css'

export function ComposerDraftEditor({
  text,
  placeholder,
  disabled,
  workspacePath: _workspacePath,
  className,
  inputRef,
  onTextChange,
  onSelectionChange,
  onRemoveToken,
  onFocus,
  onBlur,
  onKeyDown,
  dragHandlers,
}: {
  text: string
  placeholder: string
  disabled?: boolean
  workspacePath: string
  className?: string
  inputRef: React.MutableRefObject<ComposerDraftInputRef>
  onTextChange: (text: string) => void
  onSelectionChange: (pos: number) => void
  onRemoveToken: (start: number, end: number) => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  dragHandlers?: {
    onPasteCapture?: (event: ClipboardEvent<HTMLElement>) => void
    onDropCapture?: (event: DragEvent<HTMLElement>) => void
    onDragOverCapture?: (event: DragEvent<HTMLElement>) => void
    onDragEnterCapture?: (event: DragEvent<HTMLElement>) => void
    onDragLeaveCapture?: (event: DragEvent<HTMLElement>) => void
  }
}) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const syncingFromInputRef = useRef(false)
  const onRemoveTokenRef = useRef(onRemoveToken)
  onRemoveTokenRef.current = onRemoveToken

  const applyCaretFromHandle = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    setComposerEditorCaretOffset(root, inputRef.current.selectionStart, inputRef.current.selectionEnd)
  }, [inputRef])

  const syncSelectionToHandle = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const start = getComposerEditorCaretOffset(root)
    inputRef.current.updateSelection(start, start)
    onSelectionChange(start)
  }, [inputRef, onSelectionChange])

  useEffect(() => {
    const handle = inputRef.current as ComposerDraftInputRef & {
      attach?: (el: HTMLElement | null, applyCaret: () => void) => void
    }
    handle.attach?.(rootRef.current, applyCaretFromHandle)
  }, [inputRef, applyCaretFromHandle])

  const applyCaretAfterRebuild = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const impl = inputRef.current as ComposerDraftInputRefImpl
    const pending = impl.consumePendingCaret?.() ?? null
    const caretPos = pending ?? inputRef.current.selectionStart
    ensureComposerEditableTail(root)
    setComposerEditorCaretOffset(root, caretPos, caretPos)
    inputRef.current.updateSelection(caretPos, caretPos)
  }, [inputRef])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || syncingFromInputRef.current) return

    if (!composerDraftDomMatchesText(root, text)) {
      renderComposerEditor(root, text, appearanceThemeId, (start, end) => {
        onRemoveTokenRef.current(start, end)
      })
      applyCaretAfterRebuild()
    } else {
      hydrateComposerDraftChipIcons(root, appearanceThemeId)
    }
    autoGrowComposerEditor(root)
  }, [text, appearanceThemeId, applyCaretAfterRebuild])

  const handleInput = () => {
    const root = rootRef.current
    if (!root) return
    syncingFromInputRef.current = true
    const next = serializeComposerEditor(root)
    syncSelectionToHandle()
    if (next !== text) {
      onTextChange(next)
    }
    autoGrowComposerEditor(root)
    requestAnimationFrame(() => {
      syncingFromInputRef.current = false
    })
  }

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      data-testid="composer-draft-editor"
      data-composer-draft={text}
      contentEditable={disabled ? false : true}
      suppressContentEditableWarning
      className={[styles.composerTextarea, styles.composerDraftEditor, className].filter(Boolean).join(' ')}
      onInput={handleInput}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onClick={syncSelectionToHandle}
      onKeyUp={syncSelectionToHandle}
      {...dragHandlers}
    />
  )
}
