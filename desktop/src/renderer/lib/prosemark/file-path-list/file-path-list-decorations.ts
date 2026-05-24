import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "../fold/core";
import { getFilePresentation } from "../../../utils/file-presentation";
import {
  resolveMarkdownFileTarget,
} from "../../../utils/markdown-file-links";
import {
  fenceLangAllowsFilePathList,
  parseFilePathListText,
} from "../../../../shared/file-path-list-text";
import { markdownFileChipOptionsFacet, type MarkdownFileChipOptions } from "../file-chip-extension";
import type { SyntaxNodeRef } from "@lezer/common";

function parseFencedCodeSource(
  state: { doc: { sliceString(from: number, to: number): string } },
  node: SyntaxNodeRef,
): { info: string; source: string } {
  let info = "";
  let source = "";

  let child = node.node.firstChild;
  while (child) {
    if (child.name === "CodeInfo") {
      info = state.doc.sliceString(child.from, child.to);
    } else if (child.name === "CodeText") {
      source += state.doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }

  return { info, source };
}

function copyIconSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", "14");
  rect.setAttribute("height", "14");
  rect.setAttribute("x", "8");
  rect.setAttribute("y", "8");
  rect.setAttribute("rx", "2");
  rect.setAttribute("ry", "2");
  rect.setAttribute("stroke", "currentColor");
  rect.setAttribute("stroke-width", "2");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  svg.append(rect, path);
  return svg;
}

function createFileIcon(path: string, options: MarkdownFileChipOptions): SVGSVGElement {
  const presentation = getFilePresentation(path, undefined, options.appearanceThemeId ?? "default");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("class", "cm-file-path-list-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("data-file-icon-token", presentation.iconToken);
  if (presentation.iconColor) icon.style.color = presentation.iconColor;
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${presentation.iconSymbolId}`);
  icon.appendChild(use);
  return icon;
}

class FilePathListWidget extends WidgetType {
  constructor(
    readonly paths: string[],
    readonly options: MarkdownFileChipOptions,
  ) {
    super();
  }

  eq(other: FilePathListWidget): boolean {
    return (
      other.paths.join("\n") === this.paths.join("\n") &&
      other.options.appearanceThemeId === this.options.appearanceThemeId &&
      other.options.worktreePath === this.options.worktreePath
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-file-path-list";
    wrapper.setAttribute("contenteditable", "false");
    wrapper.setAttribute("data-testid", "markdown-file-path-list");

    const header = document.createElement("div");
    header.className = "cm-file-path-list-header";

    const count = document.createElement("span");
    count.className = "cm-file-path-list-count";
    count.textContent = `${this.paths.length} ${this.paths.length === 1 ? "file" : "files"}`;
    header.appendChild(count);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "cm-file-path-list-copy";
    copyButton.setAttribute("aria-label", "Copy all file paths");
    copyButton.title = "Copy all paths";
    copyButton.appendChild(copyIconSvg());
    const copyLabel = document.createElement("span");
    copyLabel.textContent = "Copy";
    copyButton.appendChild(copyLabel);
    copyButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void navigator.clipboard.writeText(this.paths.join("\n")).then(() => {
        copyLabel.textContent = "Copied";
        window.setTimeout(() => {
          copyLabel.textContent = "Copy";
        }, 1500);
      });
    });
    header.appendChild(copyButton);
    wrapper.appendChild(header);

    const list = document.createElement("ul");
    list.className = "cm-file-path-list-rows";

    for (const path of this.paths) {
      const item = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "cm-file-path-list-row";
      row.title = path;
      row.setAttribute("aria-label", `Open ${path}`);

      row.appendChild(createFileIcon(path, this.options));

      const label = document.createElement("span");
      label.className = "cm-file-path-list-path";
      label.textContent = path;
      row.appendChild(label);

      const target = resolveMarkdownFileTarget(path, this.options);
      if (target && this.options.onOpenFile) {
        row.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.options.onOpenFile?.(target);
        });
      } else {
        row.disabled = true;
      }

      item.appendChild(row);
      list.appendChild(item);
    }

    wrapper.appendChild(list);
    return wrapper;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}

const filePathListFoldExtension = foldableSyntaxFacet.of({
  nodePath: "FencedCode",
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node) => {
    const parsed = parseFencedCodeSource(state, node);
    if (!fenceLangAllowsFilePathList(parsed.info)) return undefined;

    const paths = parseFilePathListText(parsed.source);
    if (!paths) return undefined;

    const options = state.facet(markdownFileChipOptionsFacet);
    const widget = new FilePathListWidget(paths, options);
    return Decoration.replace({ widget, block: true, inclusiveStart: true }).range(node.from, node.to);
  },
});

export function filePathListDecorations() {
  return [filePathListFoldExtension];
}

export { FilePathListWidget, parseFencedCodeSource };
