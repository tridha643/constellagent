import type { editor } from 'monaco-editor'
import { useAppStore } from '../store/app-store'

type Run = () => void

let focused: { ed: editor.IStandaloneCodeEditor; run: Run } | null = null

// KeyMod.CtrlCmd | KeyCode.KeyF — hard-coded so this module stays free of the
// monaco-editor runtime import (kept tree-shakeable for tests).
const CMD_F_BINDING = 2048 | 36

/** Editors created by file tabs — same module instance as @monaco-editor/react (getEditors() may not be). */
const fileTabEditors = new Set<editor.IStandaloneCodeEditor>()
/** Reverse map so the global fallback can recover the file path from a focused editor. */
const editorToFilePath = new WeakMap<editor.IStandaloneCodeEditor, string>()

function readEditorSelection(ed: editor.IStandaloneCodeEditor): string {
  try {
    const selection = ed.getSelection()
    if (!selection || selection.isEmpty()) return ''
    const value = ed.getModel()?.getValueInRange(selection) ?? ''
    // Monaco considers a multi-line selection valid for Cmd+F; fff-node's
    // plain grep treats input as a single literal, so a raw newline would
    // never match. Clip at the first line break to keep the seed useful.
    const firstBreak = value.indexOf('\n')
    return firstBreak >= 0 ? value.slice(0, firstBreak) : value
  } catch {
    return ''
  }
}

/**
 * Register this Monaco instance for shell-driven shortcuts and install the
 * editor-scoped Cmd+F override that routes to the QuickOpen palette with the
 * active file pinned as fff's code-search scope. Disposing removes both the
 * registration and the Cmd+F binding.
 */
export function registerMonacoFileEditorForShortcuts(
  ed: editor.IStandaloneCodeEditor,
  filePath: string,
): () => void {
  fileTabEditors.add(ed)
  editorToFilePath.set(ed, filePath)
  // Override Cmd+F so Monaco's inline find widget never opens while this
  // editor is focused. Monaco's addCommand has no dispose; the binding lives
  // with the editor instance, and the editor is disposed with its React tab.
  ed.addCommand(CMD_F_BINDING, () => {
    const initialQuery = readEditorSelection(ed)
    // Untitled / unsaved-to-disk buffers have no real path; fff has nothing to
    // search, so fall back to the plain worktree palette instead of pinning a
    // nonexistent active-file scope.
    if (!filePath) {
      useAppStore.getState().toggleQuickOpen()
      return
    }
    useAppStore.getState().openQuickOpenFromEditor({
      filePath,
      initialQuery: initialQuery || undefined,
    })
  })
  return () => {
    fileTabEditors.delete(ed)
    editorToFilePath.delete(ed)
  }
}

export function getFilePathForMonacoEditor(ed: editor.IStandaloneCodeEditor): string | null {
  return editorToFilePath.get(ed) ?? null
}

export function getFocusedMonacoEditor(): editor.IStandaloneCodeEditor | null {
  return focused?.ed ?? null
}

export function setMonacoAddToChatHandler(ed: editor.IStandaloneCodeEditor, run: Run) {
  focused = { ed, run }
}

export function clearMonacoAddToChatHandler(ed: editor.IStandaloneCodeEditor) {
  if (focused?.ed === ed) focused = null
}

/** Invoked from capture-phase ⌘L when focus is inside Monaco. */
export function runMonacoAddToChatIfFocused(): boolean {
  if (!focused) return false
  focused.run()
  return true
}

function getDomNode(ed: editor.ICodeEditor): HTMLElement | null {
  const node = (ed as unknown as { getDomNode?: () => HTMLElement | null }).getDomNode?.()
  return node ?? null
}

function hasWidgetFocusSafe(ed: editor.ICodeEditor): boolean {
  try {
    return (ed as { hasWidgetFocus?: () => boolean }).hasWidgetFocus?.() ?? false
  } catch {
    return false
  }
}

function monacoEditorForFindShortcut(): editor.IStandaloneCodeEditor | null {
  for (const ed of fileTabEditors) {
    if (ed.hasTextFocus() || hasWidgetFocusSafe(ed)) return ed
  }

  const ae = document.activeElement
  const monacoHost = ae instanceof HTMLElement ? ae.closest('[class*="monaco-editor"]') : null
  if (monacoHost) {
    for (const ed of fileTabEditors) {
      const dom = getDomNode(ed)
      if (dom && (dom === monacoHost || dom.contains(ae))) return ed
    }
  }

  return getFocusedMonacoEditor()
}

/**
 * Window-level ⌘F / Ctrl+F fallback for the case where Monaco's own
 * `editor.addCommand` didn't intercept — e.g. focus is on a Monaco widget that
 * isn't the text area, or focus has left the editor but the caller marked
 * `allowUnfocusedMonacoFind` (single file tab without splits). Opens the
 * QuickOpen palette in editor-find mode with fff's active-file scope pinned to
 * the focused editor's file path, instead of triggering Monaco's native inline
 * find widget.
 */
export function openQuickOpenFromFocusedEditor(allowUnfocusedMonacoFind: boolean): boolean {
  let ed = monacoEditorForFindShortcut()
  if (!ed && allowUnfocusedMonacoFind && fileTabEditors.size === 1) {
    ed = [...fileTabEditors][0]
  }
  if (!ed) return false
  const filePath = editorToFilePath.get(ed)
  if (!filePath) return false
  const initialQuery = readEditorSelection(ed)
  useAppStore.getState().openQuickOpenFromEditor({
    filePath,
    initialQuery: initialQuery || undefined,
  })
  return true
}
