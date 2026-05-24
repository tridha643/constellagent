import { syntaxTree } from "@codemirror/language";
import { Facet, RangeSetBuilder, type EditorState, type Extension, Prec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { getFilePresentation } from "../../utils/file-presentation";
import {
  findMarkdownFileReferences,
  isLikelyMarkdownFilePath,
  markdownBasename,
  resolveMarkdownFileTarget,
  type MarkdownFileTarget,
} from "../../utils/markdown-file-links";
import type { AppearanceThemeId } from "../../theme/appearance";
import { shouldRebuildProsemarkDecorations } from "./decoration-sync";
import {
  findMarkdownSkillSlashReferences,
  isLikelySkillIdentifier,
} from "../../../shared/skill-tool-utils";

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

interface FileChipDecoration {
  from: number;
  to: number;
  decoration: Decoration;
}

interface BlockedRange {
  from: number;
  to: number;
}

function nodeText(view: EditorView, node: SyntaxNodeRef): string | undefined {
  return view.state.doc.sliceString(node.from, node.to);
}

function linkHrefFromState(state: EditorState, node: SyntaxNodeRef): string | undefined {
  let href: string | undefined;
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return undefined;
  do {
    if (cursor.name === "URL") {
      href = state.doc.sliceString(cursor.from, cursor.to);
      break;
    }
  } while (cursor.nextSibling());
  return href;
}

function linkHref(view: EditorView, node: SyntaxNodeRef): string | undefined {
  return linkHrefFromState(view.state, node);
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

export function linkHrefFromNode(state: EditorState, node: SyntaxNodeRef): string | undefined {
  return linkHrefFromState(state, node);
}

function inlineCodeTextFromState(state: EditorState, node: SyntaxNodeRef): string {
  let text = "";
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return text;
  do {
    if (cursor.name === "CodeMark") continue;
    text += state.doc.sliceString(cursor.from, cursor.to);
  } while (cursor.nextSibling());
  return text.trim();
}

function inlineCodeText(view: EditorView, node: SyntaxNodeRef): string {
  return inlineCodeTextFromState(view.state, node);
}

export function inlineCodePathFromNode(state: EditorState, node: SyntaxNodeRef): string | undefined {
  const text = inlineCodeTextFromState(state, node);
  return text.length > 0 ? text : undefined;
}

function addFileChipDecoration(
  decorations: FileChipDecoration[],
  view: EditorView,
  node: SyntaxNodeRef,
  href: string,
  label: string | undefined,
  options: MarkdownFileChipOptions,
): void {
  const target = resolveMarkdownFileTarget(href, options);
  if (!target) return;
  const raw = nodeText(view, node) ?? "";
  const chipLabel = label ?? markdownBasename(target.displayPath);
  const resolvedLabel = chipLabel === raw ? markdownBasename(target.displayPath) : chipLabel;
  decorations.push({
    from: node.from,
    to: node.to,
    decoration: Decoration.replace({
      widget: new FileChipWidget(target, resolvedLabel, options),
    }),
  });
}

function addBareFileChipDecoration(
  decorations: FileChipDecoration[],
  from: number,
  to: number,
  path: string,
  options: MarkdownFileChipOptions,
): void {
  const target = resolveMarkdownFileTarget(path, options);
  if (!target) return;
  decorations.push({
    from,
    to,
    decoration: Decoration.replace({
      widget: new FileChipWidget(target, markdownBasename(target.displayPath), options),
    }),
  });
}

function rangesOverlap(a: BlockedRange, b: BlockedRange): boolean {
  return a.from < b.to && b.from < a.to;
}

function isBlocked(range: BlockedRange, blockedRanges: readonly BlockedRange[]): boolean {
  return blockedRanges.some((blocked) => rangesOverlap(range, blocked));
}

function addBareSkillChipDecoration(
  decorations: FileChipDecoration[],
  from: number,
  to: number,
  name: string,
): void {
  decorations.push({
    from,
    to,
    decoration: Decoration.replace({
      widget: new SkillChipWidget(name),
    }),
  });
}

function addSkillChipDecoration(
  decorations: FileChipDecoration[],
  node: SyntaxNodeRef,
  name: string,
): void {
  decorations.push({
    from: node.from,
    to: node.to,
    decoration: Decoration.replace({
      widget: new SkillChipWidget(name),
    }),
  });
}

class SkillChipWidget extends WidgetType {
  constructor(private readonly name: string) {
    super();
  }

  eq(other: SkillChipWidget): boolean {
    return other.name === this.name;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-skill-chip";
    chip.title = `/${this.name}`;
    chip.setAttribute("data-testid", "markdown-skill-chip");
    chip.setAttribute("contenteditable", "false");

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("class", "cm-skill-chip-icon");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("width", "12");
    icon.setAttribute("height", "12");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    const frame = document.createElementNS("http://www.w3.org/2000/svg", "path");
    frame.setAttribute(
      "d",
      "M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z",
    );
    frame.setAttribute("stroke-width", "1.2");
    const lines = document.createElementNS("http://www.w3.org/2000/svg", "path");
    lines.setAttribute("d", "M5 5.5h6M5 8h4");
    lines.setAttribute("stroke-width", "1.2");
    lines.setAttribute("stroke-linecap", "round");
    icon.append(frame, lines);
    chip.appendChild(icon);

    const text = document.createElement("span");
    text.className = "cm-skill-chip-label";
    text.textContent = this.name;
    chip.appendChild(text);

    return chip;
  }

  ignoreEvent(): boolean {
    return true;
  }
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
    button.setAttribute("data-testid", "markdown-file-chip");
    button.style.pointerEvents = "auto";
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
  const decorations: FileChipDecoration[] = [];
  const blockedRanges: BlockedRange[] = [];
  const builder = new RangeSetBuilder<Decoration>();
  const options = view.state.facet(markdownFileChipOptionsFacet);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (
          node.name === "Link" ||
          node.name === "Image" ||
          node.name === "InlineCode" ||
          node.name === "FencedCode" ||
          node.name === "CodeBlock"
        ) {
          blockedRanges.push({ from: node.from, to: node.to });
        }
        if (node.name === "Link") {
          const href = linkHref(view, node);
          addFileChipDecoration(decorations, view, node, href ?? "", linkLabel(view, node), options);
          return;
        }
        if (node.name === "InlineCode") {
          const path = inlineCodeText(view, node);
          if (!path) return;
          if (isLikelyMarkdownFilePath(path)) {
            addFileChipDecoration(decorations, view, node, path, markdownBasename(path), options);
            return;
          }
          if (isLikelySkillIdentifier(path)) {
            addSkillChipDecoration(decorations, node, path);
          }
        }
      },
    });
  }

  const seenLines = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (!seenLines.has(line.from)) {
        seenLines.add(line.from);
        for (const reference of findMarkdownFileReferences(line.text)) {
          const refRange = { from: line.from + reference.from, to: line.from + reference.to };
          if (isBlocked(refRange, blockedRanges)) continue;
          addBareFileChipDecoration(decorations, refRange.from, refRange.to, reference.path, options);
        }
        for (const reference of findMarkdownSkillSlashReferences(line.text)) {
          const refRange = { from: line.from + reference.from, to: line.from + reference.to };
          if (isBlocked(refRange, blockedRanges)) continue;
          addBareSkillChipDecoration(decorations, refRange.from, refRange.to, reference.name);
        }
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of decorations) {
    builder.add(item.from, item.to, item.decoration);
  }

  return builder.finish();
}

export function markdownFileChipExtension(options: MarkdownFileChipOptions): Extension {
  return [
    markdownFileChipOptionsFacet.of(options),
    Prec.high(
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
    ),
  ];
}
