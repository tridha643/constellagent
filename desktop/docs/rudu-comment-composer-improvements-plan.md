# Rudu-inspired comment-leaving experience — plan

Status: DRAFT (pre-grill). Improves the Review Changes comment composer
(`ReviewCommentComposer.tsx`), taking inspiration from rudu's
`review-comment-composer`. Built on the repo's existing **prosemark / CodeMirror 6**
stack — **not** Lexical (locked decision below).

## Goal & success criteria

Replace the plain `<textarea>` comment composer with a CodeMirror-6 markdown
editor that gives reviewers rudu's comment-leaving affordances. "Done" means,
observably:

1. The composer is a syntax-highlighted CodeMirror editor (markdown), not a
   monospace textarea.
2. A formatting toolbar (bold, italic, strikethrough, inline code, code block,
   quote, bullet list, numbered list, task list, heading, link, and — when
   `allowSuggestion` — a suggestion block) inserts/toggles the right markdown at
   the cursor/selection and returns focus to the editor.
3. Keyboard parity: `Mod-b/i/`` `/k/Shift-x` format; `Mod-Enter` submits;
   `Escape` cancels. The submit button shows the `⌘↵` shortcut chip.
4. The existing behaviors are preserved byte-for-byte where not explicitly
   changed: optimistic insert + rollback, `window.api.review.commentAdd`, the
   suggestion-seed pre-fill (multi-line selection → ```suggestion block recorded
   as pristine), dirty/discard tracking via `useReviewComposerSession`, the
   line/side pills, the "Add to Chat" secondary action.

Non-success (explicitly NOT in scope): full WYSIWYG rendering (rudu's Lexical
live-render), Shiki highlighting *inside* the composer's code fences, image
attachments, @-mentions, the raw-markdown dual-mode fallback.

## Current state (concrete problems)

`ReviewCommentComposer.tsx` (196 lines) renders a plain `<textarea>`:

1. **No formatting affordances.** A reviewer must hand-type all markdown
   (`**`, `` ` ``, `-`, `>`). No toolbar, no shortcuts beyond `Mod-Enter`. rudu
   exposes 12 toolbar actions + markdown-shortcut typing.
2. **No syntax feedback.** The textarea is monospace plain text; headings,
   emphasis, code, and the ```suggestion fence all look identical while typing.
3. **Suggestion mode is a blunt toggle.** `toggleSuggestion` only swaps the
   placeholder and (when empty) injects a fence; it doesn't wrap a selection or
   place the cursor inside the fence like rudu's `insertSuggestionBlock`.

## Scope & non-goals

- **In:** `ReviewCommentComposer.tsx` (rewrite of the input surface only),
  one new editor component + one new block-command module, exporting the existing
  inline-format commands, CSS for the toolbar/editor, tests.
- **Not touched:** `useReviewComposerSession.ts` contract (props unchanged),
  `useReviewThreads.ts`, `annotation-service.ts`, IPC channels, the thread data
  model (`diff-annotation-types.ts`), `PatchCodeView.tsx` wiring, the M2 thread
  replacement (separate track — see `[[rudu-annotation-port]]`).
- **No new npm dependencies** — all `@codemirror/*` packages are already present.

## Research conclusion (nia-grounded)

Checked rudu source indexed in nia (`tanvesh01/rudu`), read
`src/components/ui/review-comment-composer.tsx` (982 lines) in full plus the
toolbar/state/render sections. Findings driving the design:

- rudu's composer is a **Lexical** rich-text editor: a `Toolbar` of 12
  `ToolbarButton`s dispatching `FORMAT_TEXT_COMMAND` / list commands /
  `$setBlocksType` / `insertCodeBlock` / `insertSuggestionBlock`; a
  `MarkdownShortcutPlugin`; Shiki-highlighted `CodeNode`s; a
  `requiresRawMarkdownEditor()` fallback for tables/HTML/math/footnotes; dirty
  tracking via `onDirtyChange`; `Mod-Enter` submit via `onKeyDownCapture`; an
  ArrowUp submit button with a `KeyboardShortcut` chip.
- The **experience** that matters (discoverable formatting toolbar, suggestion
  block that wraps a selection, syntax feedback, keyboard submit with a visible
  chip) is reproducible on the repo's existing CodeMirror stack **without**
  Lexical's ~15 packages, which would overlap the app's own CodeMirror+Shiki.
- The repo **already ships the hard part**: `markdownFormattingKeymap.ts`
  implements `toggleStrongEmphasis / toggleEmphasis / toggleInlineCode /
  toggleStrikethrough / insertLink` as CodeMirror `Command`s (Lezer-aware
  toggle-off), and prosemark exposes reusable markdown syntax highlights + theme.
  Only block-level commands (quote/list/heading/code-block/suggestion) and the
  toolbar UI are missing.

Convergence signal: both rudu (Lexical) and the repo's own prosemark editor
converge on the *same* markdown-command set; reusing the repo's commands keeps
one source of truth for formatting behavior.

## Locked decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Editor engine | CodeMirror 6 (prosemark stack). **No Lexical.** No new deps. |
| 2 | Inline format commands | Reuse `markdownFormattingKeymap.ts`; **export** the 5 `Command`s so the toolbar can invoke them. Keep the keymap binding too. |
| 3 | Block commands (new) | New module `markdownBlockCommands.ts`: `toggleQuote`, `toggleBulletList`, `toggleOrderedList`, `toggleTaskList`, `toggleHeading` (h3), `insertCodeBlock`, `insertSuggestionBlock`. Line-prefix toggles + fenced-block insert. |
| 4 | Suggestion block | `insertSuggestionBlock(view, seed?)` wraps the current selection (or `seed`, or a placeholder) in a ```suggestion fence and selects the body. Replaces the current `suggestionBlock()` string concat. |
| 5 | Editor mount | New `MarkdownComposerEditor.tsx` — a thin controlled CodeMirror wrapper (value/onChange/onSubmit/onCancel/autoFocus). Editable (no `EditorView.editable.of(false)`), `history()`, `defaultKeymap`, prosemark markdown + theme + format keymaps. |
| 6 | Controlled value | Editor is controlled by `body` (same prop the textarea used). External `body` changes (seed pre-fill, submit clear) reconcile into the doc via a guarded `dispatch` (skip when doc already equals `body`) to avoid loops. |
| 7 | Submit / cancel | `Mod-Enter` → submit, `Escape` → cancel, wired as high-precedence CM keymap **and** mirrored on the container `onKeyDownCapture` (belt-and-suspenders for focus edge cases). Submit disabled when `!body.trim()` or busy. |
| 8 | Submit button | Keep button; add an inline `⌘↵` shortcut chip (reuse existing shortcut-hint util `modShortcutHintLabel()`), label stays "Comment" / "Suggest a change" by mode. |
| 9 | Toolbar gating | Toolbar always visible; suggestion button only when `allowSuggestion`. Buttons disabled while `busy`. |
| 10 | Mode label | Drop the separate `suggesting` boolean as the source of truth for content; keep a derived header label ("Suggest a change" when body starts with a ```suggestion fence) so the suggestion toggle button still reads correctly. Suggestion seed path unchanged. |
| 11 | Backward-compat | `ReviewCommentComposer` public props unchanged (same interface `PatchCodeView.tsx` passes). Internal textarea swapped for the editor; `data-testid="diff-comment-composer-textarea"` preserved on the editor's contentEditable host (or an alias added) so existing e2e selectors still resolve. |
| 12 | Theming | Reuse prosemark `baseTheme` + `darkTheme` + syntax highlights, scoped via a composer-specific wrapper class so it inherits rudu tokens already in `AnnotationBubble.module.css`. |

## Architecture

```
ReviewCommentComposer.tsx  (orchestration: props, submit, optimistic, pills)
 ├─ FormattingToolbar       (buttons → command(view))           [new, in-file or sibling]
 └─ MarkdownComposerEditor  (controlled CodeMirror 6 wrapper)    [new file]
        imports:
          markdownFormattingKeymap.ts  (inline cmds — export added)
          markdownBlockCommands.ts     (block cmds — new file)
          prosemark syntaxHighlighting/theme (reused)
```

Data flow unchanged below the editor: `submit()` → optimistic `onApply({insert})`
→ `window.api.review.commentAdd(...)` → rollback on throw. `onDirtyChange`,
`onSeedPristine`, `onAddToChat`, line/side pills all preserved.

## File changes

**New**
- `patch-viewer/MarkdownComposerEditor.tsx` — controlled CM6 editor; exposes the
  live `EditorView` to the toolbar (via ref/callback) so buttons dispatch commands.
- `patch-viewer/markdownBlockCommands.ts` — block-level `Command`s (decision #3/#4).
- `patch-viewer/markdownBlockCommands.test.ts` — unit tests (bun).

**Modified**
- `lib/prosemark/markdownFormattingKeymap.ts` — `export` the 5 inline `Command`s
  (no behavior change; keymap untouched).
- `patch-viewer/ReviewCommentComposer.tsx` — swap textarea → editor + toolbar;
  rework `suggestionBlock`/`toggleSuggestion` to use `insertSuggestionBlock`;
  add `⌘↵` chip. Public props unchanged.
- `Editor/AnnotationBubble.module.css` — toolbar + editor host styles (rudu look).

## Exhaustive case coverage

Toolbar / command behaviors (each → explicit behavior):

| Action | Empty selection | Non-empty selection | Already-applied (toggle off) |
|--------|-----------------|---------------------|------------------------------|
| Bold | insert `****`, cursor between | wrap `**sel**`, keep sel inside | strip `**…**` (existing) |
| Italic | `__`, cursor between | wrap `_sel_` | strip (existing) |
| Strikethrough | `~~~~` | wrap `~~sel~~` | strip (existing) |
| Inline code | `` `` `` | wrap `` `sel` `` | strip (existing) |
| Link | `[]()` cursor in `[]` | `[sel]()` cursor in `()` | n/a (insert only) |
| Code block | fence at line, cursor inside | wrap sel lines in fence | n/a (insert) |
| Quote | prefix `> ` on line | prefix `> ` each selected line | remove `> ` if all lines quoted |
| Bullet list | `- ` on line | `- ` each line | remove if all lines bulleted |
| Numbered list | `1. ` on line | `1.`,`2.`… each line | remove if all numbered |
| Task list | `- [ ] ` on line | each line | remove if all tasks |
| Heading (h3) | `### ` prefix | `### ` on first line | remove if already h3 |
| Suggestion | ```` ```suggestion\n<placeholder>\n``` ```, select body | wrap sel in ```suggestion fence | n/a (insert) |

Composer lifecycle:

| Case | Behavior |
|------|----------|
| Multi-line selection seed (`suggestionSeed`, `lineEnd>lineNumber`) | pre-fill ```suggestion block once, recorded pristine (no dirty) — unchanged |
| `Mod-Enter` with non-empty body | submit; optimistic insert; clear; `onSaved()` |
| `Mod-Enter` with empty/whitespace body | no-op (button disabled, command returns false) |
| `Escape` | `onCancel()` |
| Submit throws (IPC) | `rollback-insert`, error toast — unchanged |
| External `body` prop change (controlled) | reconcile doc only if differs (decision #6) — no cursor jump on identical |
| `allowSuggestion=false` | suggestion toolbar button hidden; seed path inert |
| `busy` | toolbar + submit disabled; editor read-only during in-flight submit |
| Dirty + selection change to other line | existing discard-confirm via session hook — unchanged |

## Test matrix (bun, colocated)

`markdownBlockCommands.test.ts` — one case per block command row above
(empty / selection / toggle-off where applicable), driving a headless
`EditorState`/`EditorView` and asserting resulting `doc` + selection:

- toggleQuote: prefix single line; prefix multi-line; un-quote when all quoted.
- toggleBulletList / toggleOrderedList / toggleTaskList: single, multi, toggle-off; numbered increments.
- toggleHeading: add `### `; toggle-off when already h3.
- insertCodeBlock: empty → fence + inner cursor; selection → wrapped.
- insertSuggestionBlock: empty → placeholder selected; selection → wrapped; seed honored.

Reuse existing: `review-suggestion-seeds.test.ts`, `review-threads.test.ts`
remain green (no model change). Composer-level behavior (submit/escape/seed)
covered by existing e2e seam (`diff-comment-composer-textarea` testid preserved);
add an e2e assertion that the toolbar Bold button wraps a selection.

## Verification

```bash
# Unit (new + existing)
bun test desktop/src/renderer/components/patch-viewer/markdownBlockCommands.test.ts
bun test desktop/src/renderer/components/patch-viewer/review-suggestion-seeds.test.ts
bun test desktop/src/renderer/components/patch-viewer/review-threads.test.ts
# Types (baseline has known pre-existing errors in src/main/* + usePatchParsing.ts)
cd desktop && bunx tsc --noEmit 2>&1 | tail -30
# e2e (review/hunk slice)
cd desktop && bun run test:review:e2e 2>&1 | tail -30
```
Manual: open Review Changes (Cmd+Shift+R) on a diff → drag-select lines → toolbar
Bold/Quote/Suggestion → ⌘↵ submits → comment renders. Light + dark.

## Risks / notes

- **R1 Controlled-editor sync loops.** Two-way binding (`body` ↔ CM doc) can
  thrash. Mitigation: guarded dispatch (decision #6); treat CM as source of truth
  while focused, only push external `body` when it differs from `state.doc`.
- **R2 e2e selector breakage.** Existing tests target the textarea testid.
  Mitigation: keep the testid on the editor host (decision #11); run
  `test:review:e2e` before declaring done.
- **R3 Focus/keymap precedence.** `Mod-Enter` could be swallowed by CM defaults
  or the global `useShortcuts` capture-phase handler (Shift+Enter kitty hack).
  Mitigation: high-precedence CM keymap + container `onKeyDownCapture` mirror;
  verify ⌘↵ and Esc manually.
- **R4 List/quote toggle-off correctness** across mixed selections (some lines
  prefixed, some not). Decision: toggle *on* if any line lacks the prefix, else
  off — enumerate in tests.
- **R5 prosemark theme bleed.** Editable editor may inherit read-only-tuned CSS.
  Mitigation: scope under a composer wrapper class; visual check both themes.
- **R6 Scope creep vs M2.** This is the composer input only; the thread-model
  replacement remains the separate locked M2 track.
