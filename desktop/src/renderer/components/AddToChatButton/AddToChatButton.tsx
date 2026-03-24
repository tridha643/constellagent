import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../store/app-store'
import styles from './AddToChatButton.module.css'

interface Position {
  top: number
  left: number
}

interface SelectionInfo {
  text: string
  filePath?: string
  startLine?: number
  endLine?: number
  position: Position
}

/**
 * Floating "Add to Chat" button that appears when text is selected
 * in a MarkdownPreview or Monaco FileEditor.
 */
export function AddToChatButton() {
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const monacoDisposableRef = useRef<{ dispose(): void } | null>(null)

  const clearSelection = useCallback(() => setSelection(null), [])

  // Extract selection info from Monaco editor
  const checkMonacoSelection = useCallback(() => {
    const editor = useAppStore.getState().activeMonacoEditor
    if (!editor) return null

    const sel = editor.getSelection()
    if (!sel || sel.isEmpty()) return null

    const model = editor.getModel()
    if (!model) return null

    const text = model.getValueInRange(sel)
    if (!text.trim()) return null

    // Get the file path from the active tab
    const state = useAppStore.getState()
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
    const filePath = activeTab?.type === 'file' ? activeTab.filePath : undefined

    // Position the button near the end of the selection
    const endPos = editor.getScrolledVisiblePosition({
      lineNumber: sel.endLineNumber,
      column: sel.endColumn,
    })

    if (!endPos) return null

    // Get the editor DOM node to calculate absolute position
    const domNode = editor.getDomNode()
    if (!domNode) return null
    const rect = domNode.getBoundingClientRect()

    return {
      text,
      filePath,
      startLine: sel.startLineNumber,
      endLine: sel.endLineNumber,
      position: {
        top: rect.top + endPos.top + endPos.height + 4,
        left: rect.left + endPos.left,
      },
    } as SelectionInfo
  }, [])

  // Extract selection info from DOM (MarkdownPreview)
  const checkDomSelection = useCallback((): SelectionInfo | null => {
    const domSel = window.getSelection()
    if (!domSel || domSel.isCollapsed || !domSel.rangeCount) return null

    const text = domSel.toString()
    if (!text.trim()) return null

    // Check that the selection is within a MarkdownPreview or editorContainer
    const anchor = domSel.anchorNode
    if (!anchor) return null
    const el = anchor instanceof HTMLElement ? anchor : anchor.parentElement
    if (!el) return null

    const previewContainer = el.closest('[class*="MarkdownPreview"], [class*="markdownPreview"], [class*="scrollArea"]')
    const editorContainer = el.closest('[class*="editorContainer"]')
    if (!previewContainer && !editorContainer) return null

    // Get the file path from the tab
    const state = useAppStore.getState()
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
    let filePath: string | undefined
    if (activeTab?.type === 'markdownPreview' || activeTab?.type === 'file') {
      filePath = activeTab.filePath
    }

    const range = domSel.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    return {
      text,
      filePath,
      position: {
        top: rect.bottom + 4,
        left: rect.right,
      },
    }
  }, [])

  const updateSelection = useCallback(() => {
    // Try Monaco first, then DOM
    const info = checkMonacoSelection() ?? checkDomSelection()
    setSelection(info)
  }, [checkMonacoSelection, checkDomSelection])

  const debouncedUpdate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(updateSelection, 200)
  }, [updateSelection])

  // Listen for DOM selection changes (MarkdownPreview and editor preview mode)
  useEffect(() => {
    const handler = () => debouncedUpdate()
    document.addEventListener('selectionchange', handler)
    return () => {
      document.removeEventListener('selectionchange', handler)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [debouncedUpdate])

  // Listen for Monaco cursor selection changes
  useEffect(() => {
    const attachMonacoListener = () => {
      monacoDisposableRef.current?.dispose()
      const editor = useAppStore.getState().activeMonacoEditor
      if (!editor) {
        monacoDisposableRef.current = null
        return
      }
      monacoDisposableRef.current = editor.onDidChangeCursorSelection(() => {
        debouncedUpdate()
      })
    }

    // Re-attach when activeMonacoEditor changes
    let prevEditor = useAppStore.getState().activeMonacoEditor
    const unsub = useAppStore.subscribe((state) => {
      if (state.activeMonacoEditor !== prevEditor) {
        prevEditor = state.activeMonacoEditor
        attachMonacoListener()
        if (!state.activeMonacoEditor) clearSelection()
      }
    })

    // Initial attach
    attachMonacoListener()

    return () => {
      unsub()
      monacoDisposableRef.current?.dispose()
    }
  }, [debouncedUpdate, clearSelection])

  // Clear button when tab changes
  useEffect(() => {
    let prevTabId = useAppStore.getState().activeTabId
    return useAppStore.subscribe((state) => {
      if (state.activeTabId !== prevTabId) {
        prevTabId = state.activeTabId
        clearSelection()
      }
    })
  }, [clearSelection])

  const handleClick = useCallback(() => {
    if (!selection) return
    useAppStore.getState().sendContextToAgent([{
      text: selection.text,
      filePath: selection.filePath,
      startLine: selection.startLine,
      endLine: selection.endLine,
    }])
    setSelection(null)
    // Clear DOM selection
    window.getSelection()?.removeAllRanges()
  }, [selection])

  if (!selection) return null

  return (
    <button
      className={styles.button}
      style={{
        top: selection.position.top,
        left: selection.position.left,
      }}
      onClick={handleClick}
      onMouseDown={(e) => e.preventDefault()} // prevent stealing focus
    >
      Add to Chat <span className={styles.kbd}>⌘L</span>
    </button>
  )
}
