import { EditorView } from "@codemirror/view";
import { Annotation, type Extension } from "@codemirror/state";
import { defaultHideExtensions } from "./hide";
import {
  blockQuoteExtension,
  bulletListExtension,
  defaultFoldableSyntaxExtensions,
  emojiExtension,
  dashExtension,
  horizonalRuleExtension,
  imageExtension,
  readOnlyTaskExtension,
  taskExtension,
} from "./fold";
import type { MarkdownImageOptions } from "./fold/image";
import { clickLinkExtension, defaultClickLinkHandler } from "./clickLink";
import { codeBlockDecorationsExtension, codeFenceTheme } from "./codeFenceExtension";
import {
  baseSyntaxHighlights,
  baseTheme,
  generalSyntaxHighlights,
  lightTheme,
} from "./syntaxHighlighting";
import { revealBlockOnArrowExtension } from "./revealBlockOnArrow";
export { prosemarkMarkdownSyntaxExtensions } from "./markdown";

/** Marks programmatic doc updates (streaming, prop sync) so changeFilter allows them. */
export const allowProgrammaticDocChange = Annotation.define<boolean>();

// READ-ONLY build of the prosemark setup.
//
// The upstream `prosemarkBasicSetup` bundles a full editing experience:
// undo history, dropCursor, indent-on-input, bracket matching/closing,
// autocompletion, a large editing keymap (default/search/history/fold/
// completion/lint + markdown formatting + indent-with-tab), and a fold
// gutter. None of that is needed to *render* streaming markdown messages, and
// the keymaps actively assume an editable document.
//
// We keep only what produces the live-preview rendering:
//  - `defaultHideExtensions`  — conceals the markdown syntax markers (the
//    whole point of the live preview; never remove).
//  - `defaultFoldableSyntaxExtensions` — fold widgets (images, rules, tasks,
//    bullets, emoji, blockquotes) that the decoration modules also extend.
//  - `revealBlockOnArrowExtension` — selection-driven reveal; inert when
//    there is no caret movement, harmless to keep.
//  - `clickLinkExtension` + `defaultClickLinkHandler` — lets rendered links be
//    clicked, which is desirable in a chat message.
//  - `codeBlockDecorationsExtension` — fenced code block rendering.
//  - `EditorView.lineWrapping` — required so long message lines wrap.
//
// Deliberately omitted (edit-only): history(), dropCursor(), indentOnInput(),
// bracketMatching(), closeBrackets(), autocompletion(), the editing keymap()
// (defaultKeymap/searchKeymap/historyKeymap/foldKeymap/completionKeymap/
// lintKeymap/closeBracketsKeymap/indentWithTab/markdownFormattingKeymap),
// fixedTabWidthExtension, softIndentExtension, and foldGutter().
export const prosemarkBasicSetup = (): Extension => [
  // ProseMark rendering setup
  defaultHideExtensions,
  defaultFoldableSyntaxExtensions,
  revealBlockOnArrowExtension,
  clickLinkExtension,
  defaultClickLinkHandler,
  codeBlockDecorationsExtension,

  EditorView.lineWrapping,
];

/** Default read-only ProseMark preset — live preview with clickable tasks, images, file chips. */
export const viewProsemarkBasicSetup = (imageOptions: MarkdownImageOptions = {}): Extension => [
  defaultHideExtensions,
  [
    blockQuoteExtension,
    bulletListExtension,
    taskExtension,
    imageExtension(imageOptions),
    emojiExtension,
    horizonalRuleExtension,
    dashExtension,
  ],
  clickLinkExtension,
  defaultClickLinkHandler,
  codeBlockDecorationsExtension,
  EditorView.lineWrapping,
];

/** @deprecated Use viewProsemarkBasicSetup */
export const chatProsemarkBasicSetup = viewProsemarkBasicSetup;

/** @deprecated Use viewProsemarkBasicSetup — kept for callers that need non-interactive tasks. */
export const readOnlyProsemarkBasicSetup = (imageOptions: MarkdownImageOptions = {}): Extension => [
  defaultHideExtensions,
  [
    blockQuoteExtension,
    bulletListExtension,
    readOnlyTaskExtension,
    imageExtension(imageOptions),
    emojiExtension,
    horizonalRuleExtension,
    dashExtension,
  ],
  clickLinkExtension,
  defaultClickLinkHandler,
  codeBlockDecorationsExtension,
  EditorView.lineWrapping,
];

export const prosemarkBaseThemeSetup = (): Extension => [
  baseSyntaxHighlights,
  generalSyntaxHighlights,
  baseTheme,
  codeFenceTheme,
];

export const prosemarkLightThemeSetup = (): Extension => [prosemarkBaseThemeSetup(), lightTheme];
