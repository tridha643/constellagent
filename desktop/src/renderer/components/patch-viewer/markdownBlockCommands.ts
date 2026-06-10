import { EditorSelection, type ChangeSpec, type EditorState, type Line } from '@codemirror/state'
import type { Command } from '@codemirror/view'

/**
 * Block-level Markdown formatting commands for the review comment composer,
 * companions to the inline toggles in `lib/prosemark/markdownFormattingKeymap.ts`.
 *
 * Two shapes:
 *  - **Line-prefix toggles** (quote / bullet / numbered / task / heading): add a
 *    prefix to every selected line if **any** line lacks it, otherwise strip it
 *    from all (all-or-nothing — see plan R4).
 *  - **Fenced inserts** (code block / suggestion): wrap the selection (or a seed /
 *    placeholder) in a fence and select the body so it can be typed over.
 */

/** Unique, sorted 1-based line numbers spanned by any selection range. */
function selectedLineNumbers(state: EditorState): number[] {
  const set = new Set<number>()
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number
    const end = state.doc.lineAt(range.to).number
    for (let n = start; n <= end; n += 1) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

/**
 * Builds a `Command` toggling a per-line prefix. `detect` both decides whether a
 * line already carries the prefix and (via its match length) how much to strip.
 * `makePrefix(index)` produces the prefix to add, receiving the line's position
 * among the selected lines so numbered lists can increment (`1.`, `2.`, …).
 */
function makeLinePrefixToggle(detect: RegExp, makePrefix: (index: number) => string): Command {
  return (view) => {
    const { state } = view
    const lineNumbers = selectedLineNumbers(state)
    if (lineNumbers.length === 0) return false
    const allHavePrefix = lineNumbers.every((n) => detect.test(state.doc.line(n).text))
    const changes: ChangeSpec[] = []
    lineNumbers.forEach((n, index) => {
      const line = state.doc.line(n)
      if (allHavePrefix) {
        const match = line.text.match(detect)
        if (match) changes.push({ from: line.from, to: line.from + match[0].length, insert: '' })
      } else if (!detect.test(line.text)) {
        changes.push({ from: line.from, to: line.from, insert: makePrefix(index) })
      }
    })
    if (changes.length === 0) return false
    view.dispatch({ changes, userEvent: 'input', scrollIntoView: true })
    return true
  }
}

export const toggleQuote = makeLinePrefixToggle(/^> /, () => '> ')
export const toggleBulletList = makeLinePrefixToggle(/^- /, () => '- ')
export const toggleTaskList = makeLinePrefixToggle(/^- \[[ xX]\] /, () => '- [ ] ')
export const toggleOrderedList = makeLinePrefixToggle(/^\d+\. /, (index) => `${index + 1}. `)

const HEADING_RE = /^#{1,6} /

/**
 * Toggle an h3 (`### `) prefix. Strips the heading when **all** selected lines are
 * already h3; otherwise normalizes every line to `### ` (replacing any existing
 * heading level rather than stacking marks).
 */
export const toggleHeading: Command = (view) => {
  const { state } = view
  const lineNumbers = selectedLineNumbers(state)
  if (lineNumbers.length === 0) return false
  const allH3 = lineNumbers.every((n) => /^### /.test(state.doc.line(n).text))
  const changes: ChangeSpec[] = []
  for (const n of lineNumbers) {
    const line = state.doc.line(n)
    const existing = line.text.match(HEADING_RE)
    const existingLen = existing ? existing[0].length : 0
    changes.push({
      from: line.from,
      to: line.from + existingLen,
      insert: allH3 ? '' : '### ',
    })
  }
  if (changes.length === 0) return false
  view.dispatch({ changes, userEvent: 'input', scrollIntoView: true })
  return true
}

/**
 * Wraps the primary selection in `open`/`close` fences and selects the wrapped
 * body. With an empty selection, `body` (a seed or placeholder, possibly empty)
 * is inserted instead; an empty body leaves the cursor on the inner blank line.
 */
function wrapFenced(view: Parameters<Command>[0], open: string, close: string, body: string): boolean {
  const { state } = view
  const range = state.selection.main
  const insert = open + body + close
  const bodyFrom = range.from + open.length
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(bodyFrom, bodyFrom + body.length),
    userEvent: 'input',
    scrollIntoView: true,
  })
  return true
}

/** Insert a plain fenced code block; selection becomes the fenced body. */
export const insertCodeBlock: Command = (view) => {
  const body = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
  return wrapFenced(view, '```\n', '\n```\n', body)
}

const SUGGESTION_PLACEHOLDER = 'suggested change'

/**
 * Insert a ```suggestion fence. Body priority: a non-empty current selection,
 * else `seed` (the selected diff lines), else a placeholder — the body is left
 * selected so it can be typed over.
 */
export function insertSuggestionBlock(seed = ''): Command {
  return (view) => {
    const { state } = view
    const range = state.selection.main
    const selected = state.sliceDoc(range.from, range.to)
    const body = selected.length > 0 ? selected : seed.length > 0 ? seed : SUGGESTION_PLACEHOLDER
    return wrapFenced(view, '```suggestion\n', '\n```\n', body)
  }
}

const SUGGESTION_OPEN_RE = /^```suggestion\s*$/
const FENCE_CLOSE_RE = /^```\s*$/

/** The ```suggestion fence block containing the primary cursor, if any. */
function findSuggestionFenceAtCursor(
  state: EditorState,
): { open: Line; close: Line | null } | null {
  const cursor = state.selection.main.head
  let open: Line | null = null
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n)
    if (open === null) {
      if (SUGGESTION_OPEN_RE.test(line.text)) open = line
    } else if (FENCE_CLOSE_RE.test(line.text)) {
      if (cursor >= open.from && cursor <= line.to) return { open, close: line }
      open = null
    }
  }
  // Unclosed fence running to end-of-doc still counts as "inside".
  if (open !== null && cursor >= open.from) return { open, close: null }
  return null
}

/**
 * Toggle a ```suggestion fence at the cursor. Outside a suggestion block this
 * inserts one (selection > seed > placeholder, same as `insertSuggestionBlock`).
 * Inside one it removes the block: the whole thing when the body is still the
 * untouched seed/placeholder, otherwise just the fences (user text is kept).
 */
export function toggleSuggestionBlock(seed = ''): Command {
  return (view) => {
    const { state } = view
    const fence = findSuggestionFenceAtCursor(state)
    if (!fence) return insertSuggestionBlock(seed)(view)

    const { open, close } = fence
    const docLength = state.doc.length
    const bodyFrom = Math.min(open.to + 1, docLength)
    const bodyTo = close ? Math.max(close.from - 1, bodyFrom) : docLength
    const body = state.sliceDoc(bodyFrom, bodyTo)
    const untouched = body === seed || body === SUGGESTION_PLACEHOLDER

    const changes: ChangeSpec[] = untouched
      ? [{ from: open.from, to: close ? Math.min(close.to + 1, docLength) : docLength, insert: '' }]
      : [
          { from: open.from, to: bodyFrom, insert: '' },
          ...(close ? [{ from: bodyTo, to: Math.min(close.to + 1, docLength), insert: '' }] : []),
        ]
    view.dispatch({ changes, userEvent: 'delete', scrollIntoView: true })
    return true
  }
}
