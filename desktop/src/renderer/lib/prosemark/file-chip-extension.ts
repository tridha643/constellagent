import { syntaxTree } from "@codemirror/language";
import { Facet, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { getFilePresentation } from "../../utils/file-presentation";
import { markdownBasename, resolveMarkdownFileTarget, type MarkdownFileTarget } from "../../utils/markdown-file-links";
import type { AppearanceThemeId } from "../../theme/appearance";
import { shouldRebuildProsemarkDecorations } from "./decoration-sync";

export interface MarkdownFileChipOptions {
  baseDir?: string;
  worktreePath?: string;
  appearanceThemeId?: AppearanceThemeId;
  onOpenFile?: (target: MarkdownFileTarget) => void;
}

export const markdownFileChipOptionsFacet = Facet.define<MarkdownFileChipOptions, MarkdownFileChipOptions>({
  combine(values) {
    return values.reduce<MarkdownFileChipOptions>((acc, value) => ({ ...acc, ...value }), {});
  },
});

function nodeText(view: EditorView, node: SyntaxNodeRef): string | undefined {
  return view.state.doc.sliceString(node.from, node.to);
}

function linkHref(view: EditorView, node: SyntaxNodeRef): string | undefined {
  let href: string | undefined;
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return undefined;
  do {
    if (cursor.name === "URL") {
      href = view.state.doc.sliceString(cursor.from, cursor.to);
      break;
    }
  } while (cursor.nextSibling());
  return href;
}

function linkLabel(view: EditorView, node: SyntaxNodeRef): string | undefined {
  let label = "";
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return undefined;
  do {
    if (cursor.name === "LinkMark" || cursor.name === "URL") continue;
    label += view.state.doc.sliceString(cursor.from, cursor.to);
  } while (cursor.nextSibling());
  const cleaned = label.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

class FileChipWidget extends WidgetType {
  constructor(
    private readonly target: MarkdownFileTarget,
    private readonly label: string,
    private readonly options: MarkdownFileChipOptions,
  ) {
    super();
  }

  eq(other: FileChipWidget): boolean {
    return (
      other.target.href === this.target.href &&
      other.target.absolutePath === this.target.absolutePath &&
      other.target.lineNumber === this.target.lineNumber &&
      other.label === this.label &&
      other.options.appearanceThemeId === this.options.appearanceThemeId &&
      other.options.onOpenFile === this.options.onOpenFile
    );
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-file-chip";
    button.title = this.target.displayPath;
    button.setAttribute("aria-label", `Open ${this.target.displayPath}`);
    button.setAttribute("data-full-path", this.target.displayPath);
    button.setAttribute("contenteditable", "false");

    const presentation = getFilePresentation(this.target.displayPath, undefined, this.options.appearanceThemeId ?? "default");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("class", "cm-file-chip-icon");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("data-file-icon-token", presentation.iconToken);
    if (presentation.iconColor) icon.style.color = presentation.iconColor;
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${presentation.iconSymbolId}`);
    icon.appendChild(use);
    button.appendChild(icon);

    const text = document.createElement("span");
    text.className = "cm-file-chip-label";
    text.textContent = this.label || markdownBasename(this.target.displayPath);
    button.appendChild(text);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.options.onOpenFile?.(this.target);
    });

    return button;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}

function fileChipDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const options = view.state.facet(markdownFileChipOptionsFacet);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "Link") return;
        const href = linkHref(view, node);
        const target = resolveMarkdownFileTarget(href, options);
        if (!target) return;
        const raw = nodeText(view, node) ?? "";
        const label = linkLabel(view, node) ?? markdownBasename(target.displayPath);
        builder.add(
          node.from,
          node.to,
          Decoration.replace({
            widget: new FileChipWidget(target, label === raw ? markdownBasename(target.displayPath) : label, options),
          }),
        );
      },
    });
  }

  return builder.finish();
}

export function markdownFileChipExtension(options: MarkdownFileChipOptions): Extension {
  return [
    markdownFileChipOptionsFacet.of(options),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = fileChipDecorations(view);
        }

        update(update: ViewUpdate) {
          if (shouldRebuildProsemarkDecorations(update)) {
            this.decorations = fileChipDecorations(update.view);
          }
        }
      },
      {
        decorations: (value) => value.decorations,
      },
    ),
  ];
}
