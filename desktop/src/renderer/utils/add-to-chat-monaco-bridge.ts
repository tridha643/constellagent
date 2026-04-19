import type { editor } from 'monaco-editor'

type Run = () => void

let focused: { ed: editor.IStandaloneCodeEditor; run: Run } | null = null

/** Editors created by file tabs — same module instance as @monaco-editor/react (getEditors() may not be). */
const fileTabEditors = new Set<editor.IStandaloneCodeEditor>()

export function registerMonacoFileEditorForShortcuts(ed: editor.IStandaloneCodeEditor): () => void {
  fileTabEditors.add(ed)
  return () => fileTabEditors.delete(ed)
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

function monacoEditorForFindShortcut(): editor.ICodeEditor | null {
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
 * Invoked from capture-phase ⌘F / Ctrl+F when a Monaco editor (or its widgets) has focus.
 * If `allowUnfocusedMonacoFind`, a lone registered editor may be used (e.g. focus still on the window after Quick Open).
 */
export function runMonacoFindIfFocused(allowUnfocusedMonacoFind: boolean): boolean {
  let ed = monacoEditorForFindShortcut()
  if (!ed && allowUnfocusedMonacoFind && fileTabEditors.size === 1) {
    ed = [...fileTabEditors][0]
  }
  if (!ed) return false
  // StartFindAction is gated on editor focus context; Quick Open can leave focus on the shell.
  if (!ed.hasTextFocus() && !hasWidgetFocusSafe(ed)) {
    ed.focus()
  }
  const action = ed.getAction('actions.find')
  if (action?.isSupported()) {
    void action.run()
    return true
  }
  if (action) {
    void action.run()
    return true
  }
  ed.trigger('keyboard', 'actions.find', null)
  return true
}
