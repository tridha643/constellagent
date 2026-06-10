import { useEffect, useRef } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { codeBlockDecorationsExtension, codeFenceTheme } from '../../lib/prosemark/codeFenceExtension'
import { prosemarkMarkdownFormattingKeymap } from '../../lib/prosemark/markdownFormattingKeymap'
import {
  baseSyntaxHighlights,
  baseTheme,
  darkTheme,
  generalSyntaxHighlights,
} from '../../lib/prosemark/syntaxHighlighting'

/**
 * Controlled, **editable** CodeMirror 6 markdown editor for the review comment
 * composer — the rudu-style input surface. Built entirely on the in-repo
 * prosemark stack (markdown language + syntax highlights + inline format keymap),
 * with no new dependencies.
 *
 * Lifecycle (plan R1): the view is created once on mount with the initial
 * `value`; an effect reconciles later external `value` changes into the doc only
 * when they differ from the current text, so user keystrokes never echo back
 * through the controlled prop. The composer is keyed per draft target by its
 * parent, so each draft gets a fresh editor.
 */
export function MarkdownComposerEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  autoFocus = false,
  readOnly = false,
  placeholder,
  onViewReady,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  onCancel: () => void
  autoFocus?: boolean
  readOnly?: boolean
  placeholder?: string
  onViewReady?: (view: EditorView) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editableCompartment = useRef(new Compartment())

  // Keep the latest callbacks/state in refs so the mount-once view config never
  // captures stale closures (CM extensions are built once at create time).
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)
  const onCancelRef = useRef(onCancel)
  onChangeRef.current = onChange
  onSubmitRef.current = onSubmit
  onCancelRef.current = onCancel

  // Mount the editor once.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const submitKeymap = Prec.highest(
      keymap.of([
        {
          key: 'Mod-Enter',
          preventDefault: true,
          run: () => {
            onSubmitRef.current()
            return true
          },
        },
        {
          key: 'Escape',
          preventDefault: true,
          run: () => {
            onCancelRef.current()
            return true
          },
        },
      ]),
    )

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          markdown(),
          history(),
          submitKeymap,
          keymap.of([...prosemarkMarkdownFormattingKeymap]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          baseTheme,
          darkTheme,
          codeFenceTheme,
          baseSyntaxHighlights,
          generalSyntaxHighlights,
          codeBlockDecorationsExtension,
          EditorView.lineWrapping,
          editableCompartment.current.of([
            EditorView.editable.of(!readOnly),
            EditorState.readOnly.of(readOnly),
          ]),
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.contentAttributes.of({
            'data-testid': 'diff-comment-composer-textarea',
            'data-comment-body': '',
            'aria-label': placeholder ?? 'Comment',
            role: 'textbox',
            'aria-multiline': 'true',
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            const text = update.state.doc.toString()
            // Mirror the doc onto the host attr for newline-accurate e2e readback.
            update.view.contentDOM.setAttribute('data-comment-body', text)
            onChangeRef.current(text)
          }),
        ],
      }),
    })
    viewRef.current = view
    view.contentDOM.setAttribute('data-comment-body', value)
    onViewReady?.(view)
    if (autoFocus) view.focus()

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Guarded reconcile: push external `value` changes (e.g. a suggestion seed) into
  // the doc only when they differ, so typing doesn't round-trip through the prop.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === view.state.doc.toString()) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
    view.contentDOM.setAttribute('data-comment-body', value)
  }, [value])

  // Reflect readOnly/busy toggles without remounting.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: editableCompartment.current.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
      ]),
    })
  }, [readOnly])

  return <div ref={hostRef} />
}
