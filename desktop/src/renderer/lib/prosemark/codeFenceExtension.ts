import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { WidgetType } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { FRONTMATTER_LANGUAGE_LABEL, isFrontmatterNode } from "./markdown/frontmatter";
import { shouldRebuildProsemarkDecorations } from "./decoration-sync";

const fallbackMonospaceCodeFont =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const codeFontFamily = `var(--pm-code-font, ${fallbackMonospaceCodeFont})`;

function copyIconSvg(size = 14): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
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

function checkIconSvg(size = 14): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "20 6 9 17 4 12");
  polyline.setAttribute("stroke", "currentColor");
  polyline.setAttribute("stroke-width", "2.25");
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");

  svg.append(polyline);
  return svg;
}

const codeBlockDecorations = (view: EditorView) => {
  const builder = new RangeSetBuilder<Decoration>();

  // If there are multiple visible ranges, it's possible to see
  // the same code block multiple times
  const visited = new Set<string>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const isFencedCode = node.name === "FencedCode";
        const isFrontmatter = isFrontmatterNode(node);

        if (isFencedCode || isFrontmatter) {
          const key = JSON.stringify([node.from, node.to]);
          if (visited.has(key)) return;
          visited.add(key);

          let lang = "";
          let code = "";
          if (isFrontmatter) {
            lang = FRONTMATTER_LANGUAGE_LABEL;
            const contentNode = node.node.getChild("FrontmatterContent");
            code = contentNode ? view.state.doc.sliceString(contentNode.from, contentNode.to) : "";
          } else {
            const codeInfoNode = node.node.getChild("CodeInfo");
            if (codeInfoNode) {
              lang = view.state.doc.sliceString(codeInfoNode.from, codeInfoNode.to).toUpperCase();
            }
            const firstLine = view.state.doc.lineAt(node.from);
            const codeStart = firstLine.to + 1;
            const codeEnd = Math.max(codeStart, node.to - 4);
            code = view.state.doc.sliceString(codeStart, codeEnd);
          }

          for (let pos = node.from; pos <= node.to; ) {
            const line = view.state.doc.lineAt(pos);
            const isFirstLine = pos === node.from;
            const isLastLine = line.to >= node.to;

            builder.add(
              line.from,
              line.from,
              Decoration.line({
                class: `cm-fenced-code-line ${
                  isFirstLine ? "cm-fenced-code-line-first" : ""
                } ${isLastLine ? "cm-fenced-code-line-last" : ""}`,
              }),
            );

            if (isFirstLine) {
              builder.add(
                line.from,
                line.from,
                Decoration.widget({
                  widget: new CodeBlockInfoWidget(lang, code),
                }),
              );
            }

            if (isFencedCode) {
              const cursor = node.node.cursor();
              cursor.iterate((child) => {
                if (
                  (child.type.name === "CodeMark" || child.type.name === "CodeInfo") &&
                  child.from >= line.from &&
                  child.to <= line.to
                ) {
                  builder.add(
                    child.from,
                    child.to,
                    Decoration.mark({ class: "cm-fenced-code-syntax" }),
                  );
                }
              });
            }

            pos = line.to + 1;
          }
        }
      },
    });
  }

  return builder.finish();
};

class CodeBlockInfoWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }

  eq(other: CodeBlockInfoWidget) {
    return other.lang === this.lang && other.code === this.code;
  }

  toDOM() {
    const container = document.createElement("span");
    container.className = "cm-code-block-info";
    container.setAttribute("contenteditable", "false");

    const langContainer = document.createElement("span");
    langContainer.className = "cm-code-block-lang-container";
    if (this.lang) {
      langContainer.innerText = this.lang;
      container.appendChild(langContainer);
    }

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "cm-code-block-copy-button";
    copyButton.setAttribute("aria-label", "Copy code");
    copyButton.title = "Copy code";

    const iconStack = document.createElement("span");
    iconStack.className = "cm-code-block-copy-icon-stack";

    const copyIcon = document.createElement("span");
    copyIcon.className = "cm-code-block-copy-icon cm-code-block-copy-icon--copy";
    copyIcon.appendChild(copyIconSvg());

    const checkIcon = document.createElement("span");
    checkIcon.className = "cm-code-block-copy-icon cm-code-block-copy-icon--check";
    checkIcon.appendChild(checkIconSvg());

    iconStack.append(copyIcon, checkIcon);
    copyButton.appendChild(iconStack);

    let resetTimer: number | undefined;
    copyButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (resetTimer !== undefined) {
        window.clearTimeout(resetTimer);
        resetTimer = undefined;
      }
      void navigator.clipboard.writeText(this.code).then(() => {
        copyButton.dataset.copied = "true";
        copyButton.setAttribute("aria-label", "Copied");
        copyButton.title = "Copied";
        resetTimer = window.setTimeout(() => {
          delete copyButton.dataset.copied;
          copyButton.setAttribute("aria-label", "Copy code");
          copyButton.title = "Copy code";
          resetTimer = undefined;
        }, 1400);
      });
    });
    container.appendChild(copyButton);

    return container;
  }

  ignoreEvent(_event: Event): boolean {
    return true;
  }
}

export const codeBlockDecorationsExtension: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = codeBlockDecorations(view);
    }

    update(update: ViewUpdate) {
      if (shouldRebuildProsemarkDecorations(update)) {
        this.decorations = codeBlockDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

export const codeFenceTheme = EditorView.theme({
  ".cm-fenced-code-line": {
    display: "block",
    marginLeft: "0",
    paddingLeft: "1.25rem",
    paddingRight: "1.25rem",
    backgroundColor: "var(--pm-code-background-color)",
    fontFamily: codeFontFamily,
    fontVariantLigatures: "none",
    fontFeatureSettings: '"calt" 0',
    fontKerning: "none",
  },
  // In case the active line color changes
  ".cm-activeLine.cm-fenced-code-line": {
    backgroundColor: "var(--pm-code-background-color)",
  },
  ".cm-fenced-code-syntax": {
    opacity: "0 !important",
    fontSize: "0 !important",
    width: "0",
    display: "inline-block",
    overflow: "hidden",
    pointerEvents: "none",
  },
  ".cm-fenced-code-line-first": {
    borderTopLeftRadius: "0.4rem",
    borderTopRightRadius: "0.4rem",
  },
  ".cm-fenced-code-line-last": {
    borderBottomLeftRadius: "0.4rem",
    borderBottomRightRadius: "0.4rem",
  },
  ".cm-code-block-info": {
    float: "right",
    padding: "0.2rem",
    display: "flex",
    gap: "0.3rem",
    alignItems: "center",
  },
  ".cm-code-block-lang-container": {
    fontSize: "0.8rem",
    color: "var(--pm-muted-color)",
  },
  ".cm-code-block-copy-button": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    padding: "0.2rem",
    borderRadius: "0.2rem",
    cursor: "pointer",
    backgroundColor: "var(--pm-code-btn-background-color)",
    color: "var(--pm-muted-color)",
    transition:
      "transform 130ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease, color 150ms ease",
  },
  ".cm-code-block-copy-button:active": {
    transform: "scale(0.97)",
  },
  ".cm-code-block-copy-button[data-copied='true']": {
    color: "var(--pm-syntax-literal, oklch(72% 0.08 170))",
  },
  ".cm-code-block-copy-icon-stack": {
    position: "relative",
    display: "flex",
    width: "16px",
    height: "16px",
  },
  ".cm-code-block-copy-icon": {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "opacity 150ms cubic-bezier(0.23, 1, 0.32, 1), transform 150ms cubic-bezier(0.23, 1, 0.32, 1)",
  },
  ".cm-code-block-copy-icon--check": {
    opacity: "0",
    transform: "scale(0.92)",
  },
  ".cm-code-block-copy-button[data-copied='true'] .cm-code-block-copy-icon--copy": {
    opacity: "0",
    transform: "scale(0.92)",
  },
  ".cm-code-block-copy-button[data-copied='true'] .cm-code-block-copy-icon--check": {
    opacity: "1",
    transform: "scale(1)",
  },
  ".cm-code-block-copy-button:hover": {
    backgroundColor: "var(--pm-code-btn-hover-background-color)",
  },
  ".cm-code-block-copy-button svg": {
    width: "16px",
    height: "16px",
  },
});
