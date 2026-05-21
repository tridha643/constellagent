import { syntaxTree } from "@codemirror/language";
import type { ViewUpdate } from "@codemirror/view";

/** Rebuild view decorations when the doc, viewport, selection, or Lezer tree changes. */
export function shouldRebuildProsemarkDecorations(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.viewportChanged ||
    update.selectionSet ||
    syntaxTree(update.startState) !== syntaxTree(update.state)
  );
}
