import {
  type EditorState,
  StateEffect,
  StateField,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { parseMarkdownTableCells } from "../../../shared/normalize-markdown-tables";
import {
  foldableSyntaxFacet,
  selectAllDecorationsOnSelectExtension,
} from "./main";
import { dragFrozenSelectionField, rangesTouchInclusive } from "./drag-selection-gate";

type Alignment = "left" | "center" | "right";

interface ParsedTable {
  headers: string[];
  alignments: (Alignment | undefined)[];
  rows: string[][];
}

function parseCells(line: string): string[] {
  return parseMarkdownTableCells(line);
}

function isDelimiterCell(cell: string): boolean {
  return /^:?-+:?$/.test(cell);
}

function isTableRowLine(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && (t.startsWith("|") || t.endsWith("|"));
}

function normalizeDelimiterCells(headers: string[], delimiterCells: string[]): string[] {
  if (delimiterCells.length === headers.length) return delimiterCells;
  if (delimiterCells.length === 1 && isDelimiterCell(delimiterCells[0] ?? "") && headers.length > 1) {
    return headers.map(() => "---");
  }
  return headers.map((_, i) => delimiterCells[i] ?? "---");
}

function parseAlignment(cell: string): Alignment | undefined {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return undefined;
}

function parseMarkdownTable(text: string): ParsedTable | undefined {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return undefined;

  const headers = parseCells(lines[0]);
  if (headers.length === 0) return undefined;

  let delimiterCells = parseCells(lines[1]);
  const isDelimiter = delimiterCells.length > 0 && delimiterCells.every(isDelimiterCell);
  if (!isDelimiter) return undefined;

  delimiterCells = normalizeDelimiterCells(headers, delimiterCells);
  const alignments = delimiterCells.map(parseAlignment);
  const rows = lines.slice(2).map(parseCells);

  return { headers, alignments, rows };
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: ParsedTable,
    readonly rawText: string,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return this.rawText === other.rawText;
  }

  toDOM(): HTMLElement {
    const { headers, alignments, rows } = this.table;

    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-widget";
    wrapper.contentEditable = "false";

    const table = wrapper.appendChild(document.createElement("table"));

    // Header
    const thead = table.appendChild(document.createElement("thead"));
    const headerRow = thead.appendChild(document.createElement("tr"));
    for (let i = 0; i < headers.length; i++) {
      const th = headerRow.appendChild(document.createElement("th"));
      th.textContent = headers[i];
      const hAlign = alignments[i];
      if (hAlign) th.style.textAlign = hAlign;
    }

    // Body
    const tbody = table.appendChild(document.createElement("tbody"));
    for (const row of rows) {
      const tr = tbody.appendChild(document.createElement("tr"));
      for (let i = 0; i < headers.length; i++) {
        const td = tr.appendChild(document.createElement("td"));
        td.textContent = row[i] ?? "";
        const dAlign = alignments[i];
        if (dAlign) td.style.textAlign = dAlign;
      }
    }

    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function tableRangesFromSyntaxTree(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Table") ranges.push({ from: node.from, to: node.to });
    },
  });
  return ranges;
}

function rangesOverlap(
  a: { from: number; to: number },
  b: { from: number; to: number },
): boolean {
  return a.from < b.to && b.from < a.to;
}

function findTableBlocksInDoc(doc: Text): { from: number; to: number }[] {
  const blocks: { from: number; to: number }[] = [];
  let lineNo = 1;

  while (lineNo <= doc.lines) {
    const header = doc.line(lineNo);
    if (!isTableRowLine(header.text) || lineNo + 1 > doc.lines) {
      lineNo += 1;
      continue;
    }

    const delimiter = doc.line(lineNo + 1);
    const delimCells = parseCells(delimiter.text);
    if (delimCells.length === 0 || !delimCells.every(isDelimiterCell)) {
      lineNo += 1;
      continue;
    }

    let endLine = lineNo + 1;
    while (endLine + 1 <= doc.lines && isTableRowLine(doc.line(endLine + 1).text)) {
      endLine += 1;
    }

    blocks.push({ from: header.from, to: doc.line(endLine).to });
    lineNo = endLine + 1;
  }

  return blocks;
}

function buildTableFallbackDecorations(state: EditorState): Range<Decoration>[] {
  const parsedRanges = tableRangesFromSyntaxTree(state);
  const decorations: Range<Decoration>[] = [];

  for (const block of findTableBlocksInDoc(state.doc)) {
    if (parsedRanges.some((r) => rangesOverlap(r, block))) continue;

    const text = state.doc.sliceString(block.from, block.to);
    const parsed = parseMarkdownTable(text);
    if (!parsed) continue;

    decorations.push(
      Decoration.replace({
        widget: new TableWidget(parsed, text),
        block: true,
        inclusiveStart: true,
      }).range(block.from, block.to),
    );
  }

  return decorations;
}

const refreshTableFallbackEffect = StateEffect.define<void>();
const TABLE_FALLBACK_REBUILD_DELAY_MS = 160;

const tableFallbackField = StateField.define<DecorationSet>({
  create(state) {
    return Decoration.set(buildTableFallbackDecorations(state), true);
  },
  update(deco, tr) {
    const shouldRebuild = tr.effects.some((effect) => effect.is(refreshTableFallbackEffect));
    if (shouldRebuild) {
      return Decoration.set(buildTableFallbackDecorations(tr.state), true);
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const tableFallbackRefresh = ViewPlugin.fromClass(
  class {
    private rebuildTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.scheduleRebuild(TABLE_FALLBACK_REBUILD_DELAY_MS);
      } else if (syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.scheduleRebuild(0);
      }
    }

    private scheduleRebuild(delay: number) {
      if (this.rebuildTimer !== undefined) {
        clearTimeout(this.rebuildTimer);
      }
      this.rebuildTimer = setTimeout(() => {
        this.rebuildTimer = undefined;
        if (!this.view.dom.isConnected) return;
        this.view.dispatch({ effects: refreshTableFallbackEffect.of() });
      }, delay);
    }

    destroy() {
      if (this.rebuildTimer !== undefined) clearTimeout(this.rebuildTimer);
    }
  },
);

const tableFoldExtension = foldableSyntaxFacet.of({
  nodePath: "Table",
  // `keepDecorationOnUnfold: true` makes prosemark always delegate the
  // decoration choice to us instead of short-circuiting when the live
  // selection touches the table range. Without it, the drag-freeze override
  // below would be bypassed and the table would unfurl mid-drag the moment
  // the extending selection enters the table.
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node, selectionTouchesRange) => {
    const frozen = state.field(dragFrozenSelectionField, false);
    const touches = frozen ? rangesTouchInclusive(frozen, node) : selectionTouchesRange;
    if (touches) return undefined;

    const text = state.doc.sliceString(node.from, node.to);
    const parsed = parseMarkdownTable(text);
    if (!parsed) return undefined;

    return Decoration.replace({
      widget: new TableWidget(parsed, text),
      block: true,
      inclusiveStart: true,
    }).range(node.from, node.to);
  },
});

const tableTheme = EditorView.baseTheme({
  ".cm-table-widget": {
    padding: "0.25em 0",
    overflowX: "auto",
  },
  ".cm-table-widget table": {
    borderCollapse: "collapse",
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
    fontSize: "0.9em",
  },
  ".cm-table-widget th, .cm-table-widget td": {
    border: "1px solid var(--border-color, #3e3e42)",
    padding: "0.4em 0.8em",
    minWidth: "10em",
  },
  ".cm-table-widget th": {
    fontWeight: "600",
    backgroundColor: "var(--code-bg, #2d2d2d)",
  },
});

/**
 * Workaround: foldExtension only rebuilds on docChanged/selection, not on syntax
 * tree progression. When the incremental parser finishes after initial load, folds
 * stay stale. This plugin detects tree changes and nudges a rebuild.
 */
const foldTreeSync = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.state) !== syntaxTree(update.startState)) {
        setTimeout(() => {
          update.view.dispatch({ selection: update.view.state.selection });
        });
      }
    }
  },
);

export function tableDecorations() {
  return [
    tableFoldExtension,
    tableFallbackField,
    tableFallbackRefresh,
    tableTheme,
    selectAllDecorationsOnSelectExtension("cm-table-widget"),
    foldTreeSync,
  ];
}
