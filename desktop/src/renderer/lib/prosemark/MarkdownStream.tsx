import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { EditorSelection, EditorState, Compartment, Prec, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

import {
  viewProsemarkBasicSetup,
  allowProgrammaticDocChange,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownSyntaxExtensions,
} from "./main";
import { darkTheme } from "./syntaxHighlighting";
import { tableDecorations } from "./table-decorations";
import { mermaidDecorations } from "./mermaid/mermaid-decorations";
import { htmlBlockDecorations, htmlBlockParserExtension } from "./html-block-decorations";
import { dragFreezeExtensions } from "./drag-selection-gate";
import { markdownFileChipExtension, type MarkdownFileChipOptions } from "./file-chip-extension";
import { clickLinkHandler } from "./clickLink";
import { resolveMarkdownFileTarget } from "../../utils/markdown-file-links";
import type { MarkdownFileTarget } from "../../utils/markdown-file-links";
import type { AppearanceThemeId } from "../../theme/appearance";
import "./prosemark-chat-theme.css";

/**
 * Imperative handle for streaming markdown into the live preview without
 * recreating the document on every token (which would discard CodeMirror's
 * incremental Lezer parse and decoration state).
 */
export interface MarkdownStreamHandle {
  /**
   * Append a streaming delta to the end of the document. Uses an insert-only
   * change so the parser only re-parses from the append point onward — this is
   * the hot path for token-by-token streaming.
   */
  appendDelta(text: string): void;
  /** Replace the entire document in one transaction. */
  setContent(text: string): void;
  /** Force a full parse + decoration rebuild (call when streaming completes). */
  refreshDecorations(): void;
}

export interface MarkdownStreamProps {
  content?: string;
  className?: string;
  compact?: boolean;
  /** Single-line surfaces (tool chips, activity ticker). */
  inline?: boolean;
  /** Resolve relative file/image markdown links against this directory. */
  baseDir?: string;
  /** Fallback root for repo-relative markdown file/image links. */
  worktreePath?: string;
  appearanceThemeId?: AppearanceThemeId;
  onOpenMarkdownFile?: (target: MarkdownFileTarget) => void;
}

const PROSEMARK_PARSE_BUDGET_MS = 25;
const PROSEMARK_DECORATION_SYNC_DELAY_MS = 120;
const prosemarkOptionsCompartment = new Compartment();
const prosemarkClickLinkCompartment = new Compartment();

function clickLinkHandlerForOptions(options: MarkdownFileChipOptions): Extension {
  return clickLinkHandler.of((url) => {
    const target = resolveMarkdownFileTarget(url, options);
    if (target && options.onOpenFile) {
      options.onOpenFile(target);
      return;
    }
    window.open(url, "_blank");
  });
}

function prosemarkLiveOptions(options: MarkdownFileChipOptions): Extension[] {
  return [
    prosemarkOptionsCompartment.of([
      viewProsemarkBasicSetup({ baseDir: options.baseDir, worktreePath: options.worktreePath }),
      markdownFileChipExtension(options),
    ]),
    prosemarkClickLinkCompartment.of(clickLinkHandlerForOptions(options)),
  ];
}

function refreshProsemarkDecorations(view: EditorView): void {
  ensureSyntaxTree(view.state, view.state.doc.length, PROSEMARK_PARSE_BUDGET_MS);
  // Nudge hide/fold/table fields to rebuild after the syntax tree catches up.
  view.dispatch({ selection: view.state.selection });
}

/**
 * foldExtension / hideExtension only rebuild on docChanged or selection changes,
 * not when Lezer finishes incremental parsing. After streaming tokens, tables
 * and list folds stay raw until we nudge a rebuild (writer.computer does the
 * same via foldTreeSync in table-decorations.ts).
 */
const prosemarkDecorationSync = ViewPlugin.fromClass(
  class {
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.scheduleRefresh(PROSEMARK_DECORATION_SYNC_DELAY_MS);
      } else if (syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.scheduleRefresh(0);
      }
    }

    private scheduleRefresh(delay: number) {
      if (this.refreshTimer !== undefined) return;
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        if (!this.view.dom.isConnected) return;
        refreshProsemarkDecorations(this.view);
      }, delay);
    }

    destroy() {
      if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    }
  },
);

// Read-only render extension set, mirroring the relevant subset of the writer
// app's `use-prosemark-editor.ts` wiring order:
//   1. markdown() language with GFM + prosemark syntax + html-block parser
//   2. viewProsemarkBasicSetup() (hide/fold/codeFence/clickLink/tasks/wrap)
//   3. base theme + syntax highlighting
//   4. heading-weight HighlightStyle (Prec.highest, matches upstream)
//   5. table / mermaid / html-block decorations + decoration sync
//   6. changeFilter (task toggles + programmatic sync only) + non-editable + wrap
function buildExtensions(options: MarkdownFileChipOptions): Extension[] {
  return [
    markdown({
      codeLanguages: languages,
      extensions: [GFM, prosemarkMarkdownSyntaxExtensions, htmlBlockParserExtension],
    }),
    ...prosemarkLiveOptions(options),
    prosemarkBaseThemeSetup(),
    darkTheme,
    Prec.highest(
      syntaxHighlighting(
        HighlightStyle.define([
          { tag: tags.strong, fontWeight: "600" },
          { tag: tags.heading, fontWeight: "600" },
          { tag: tags.heading1, fontWeight: "600" },
          { tag: tags.heading2, fontWeight: "600" },
          { tag: tags.heading3, fontWeight: "600" },
          { tag: tags.heading4, fontWeight: "600" },
          { tag: tags.heading5, fontWeight: "600" },
          { tag: tags.heading6, fontWeight: "600" },
        ]),
      ),
    ),
    tableDecorations(),
    mermaidDecorations(),
    htmlBlockDecorations(),
    dragFreezeExtensions,
    prosemarkDecorationSync,
    EditorState.changeFilter.of((tr) => {
      if (!tr.docChanged) return true;
      if (tr.annotation(allowProgrammaticDocChange)) return true;
      let allowed = true;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (!isTaskMarkerToggle(tr.startState, fromA, toA, inserted.toString())) {
          allowed = false;
        }
      });
      return allowed;
    }),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
  ];
}

function isTaskMarkerToggle(
  state: EditorState,
  from: number,
  to: number,
  insert: string,
): boolean {
  if (to - from !== 1 || (insert !== "x" && insert !== " ")) return false;
  const removed = state.doc.sliceString(from, to);
  if (removed !== "x" && removed !== " ") return false;
  const line = state.doc.lineAt(from);
  const prefix = line.text.slice(0, from - line.from + 4);
  return /^\s*[-*+]\s\[[ xX]\]/.test(prefix);
}

function selectionAtEnd(docLength: number) {
  return EditorSelection.cursor(docLength);
}

function dispatchDocChange(view: EditorView, spec: Parameters<EditorView["dispatch"]>[0]): void {
  view.dispatch({ ...spec, annotations: allowProgrammaticDocChange.of(true) });
}

function liveOptionsEqual(a: MarkdownFileChipOptions, b: MarkdownFileChipOptions): boolean {
  return (
    a.baseDir === b.baseDir &&
    a.worktreePath === b.worktreePath &&
    a.appearanceThemeId === b.appearanceThemeId &&
    a.onOpenFile === b.onOpenFile
  );
}

const MarkdownStream = forwardRef<MarkdownStreamHandle, MarkdownStreamProps>(function MarkdownStream(
  { content, className, compact, inline: inlineMode, baseDir, worktreePath, appearanceThemeId, onOpenMarkdownFile },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveOptionsRef = useRef<MarkdownFileChipOptions>({
    baseDir,
    worktreePath,
    appearanceThemeId,
    onOpenFile: onOpenMarkdownFile,
  });
  // True once any imperative streaming call has run; while streaming we ignore
  // `content`-prop changes so the prop and the stream don't fight over the doc.
  const streamingRef = useRef(false);
  // Track what we last pushed via the `content` prop so a re-render with an
  // unchanged prop doesn't needlessly replace the document.
  const lastPropContentRef = useRef<string | undefined>(undefined);

  useImperativeHandle(
    ref,
    (): MarkdownStreamHandle => ({
      appendDelta(text: string) {
        const view = viewRef.current;
        if (!view || text.length === 0) return;
        streamingRef.current = true;
        const insertAt = view.state.doc.length;
        view.dispatch({
          changes: { from: insertAt, insert: text },
          selection: selectionAtEnd(insertAt + text.length),
          annotations: allowProgrammaticDocChange.of(true),
        });
      },
      setContent(text: string) {
        const view = viewRef.current;
        if (!view) return;
        streamingRef.current = true;
        dispatchDocChange(view, {
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: selectionAtEnd(text.length),
        });
      },
      refreshDecorations() {
        const view = viewRef.current;
        if (!view) return;
        refreshProsemarkDecorations(view);
      },
    }),
    [],
  );

  // Mount the single EditorView once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initialDoc = content ?? "";
    const initialOptions: MarkdownFileChipOptions = {
      baseDir,
      worktreePath,
      appearanceThemeId,
      onOpenFile: onOpenMarkdownFile,
    };
    liveOptionsRef.current = initialOptions;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialDoc,
        selection: selectionAtEnd(initialDoc.length),
        extensions: buildExtensions(initialOptions),
      }),
    });
    viewRef.current = view;
    lastPropContentRef.current = content;
    if (initialDoc.length > 0) {
      queueMicrotask(() => refreshProsemarkDecorations(view));
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const nextOptions: MarkdownFileChipOptions = {
      baseDir,
      worktreePath,
      appearanceThemeId,
      onOpenFile: onOpenMarkdownFile,
    };
    if (liveOptionsEqual(liveOptionsRef.current, nextOptions)) return;
    liveOptionsRef.current = nextOptions;
    view.dispatch({
      effects: [
        prosemarkOptionsCompartment.reconfigure([
          viewProsemarkBasicSetup({ baseDir, worktreePath }),
          markdownFileChipExtension(nextOptions),
        ]),
        prosemarkClickLinkCompartment.reconfigure(clickLinkHandlerForOptions(nextOptions)),
      ],
    });
    queueMicrotask(() => refreshProsemarkDecorations(view));
  }, [baseDir, worktreePath, appearanceThemeId, onOpenMarkdownFile]);

  // Sync the `content` prop into the view when it changes and no streaming is
  // in progress. Once streaming has started, the imperative API owns the doc.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (streamingRef.current) return;
    if (content === undefined) return;
    if (content === lastPropContentRef.current) return;
    lastPropContentRef.current = content;
    dispatchDocChange(view, {
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: selectionAtEnd(content.length),
    });
    queueMicrotask(() => refreshProsemarkDecorations(view));
  }, [content]);

  const rootClass = [
    "prosemark-chat",
    compact ? "prosemark-chat-compact" : "",
    inlineMode ? "prosemark-chat-inline" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <div ref={hostRef} className={rootClass} />;
});

export default MarkdownStream;
