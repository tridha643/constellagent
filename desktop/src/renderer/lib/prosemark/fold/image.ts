import { Facet } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet, selectAllDecorationsOnSelectExtension } from "./core";
import { iterChildren } from "../utils";
import { resolveMarkdownImageSrc } from "../../../utils/markdown-file-links";

export interface MarkdownImageOptions {
  baseDir?: string;
  worktreePath?: string;
}

export const markdownImageOptionsFacet = Facet.define<MarkdownImageOptions, MarkdownImageOptions>({
  combine(values) {
    return values.reduce<MarkdownImageOptions>((acc, value) => ({ ...acc, ...value }), {});
  },
});

class ImageWidget extends WidgetType {
  constructor(
    public url: string,
    public alt: string | undefined,
    public block?: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return this.url === other.url && this.alt === other.alt && this.block === other.block;
  }

  toDOM() {
    const elem = document.createElement(this.block ? "figure" : "span");
    elem.className = "cm-image";
    if (this.block) {
      elem.className += " cm-image-block";
    }
    const image = document.createElement("img");
    image.src = this.url;
    image.alt = this.alt ?? "";
    image.loading = "lazy";
    image.decoding = "async";
    image.setAttribute("data-testid", "markdown-image");
    image.style.pointerEvents = "auto";
    image.addEventListener("error", () => {
      image.setAttribute("data-load-state", "error");
      if (this.alt) image.setAttribute("title", this.alt);
    });
    elem.appendChild(image);
    if (this.block && this.alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = this.alt;
      elem.appendChild(caption);
    }
    return elem;
  }

  // allows clicks to pass through to the editor
  ignoreEvent(_event: Event) {
    return false;
  }
}

export const imageExtension = (options: MarkdownImageOptions = {}) => [
  markdownImageOptionsFacet.of(options),
  foldableSyntaxFacet.of({
    nodePath: "Image",
    keepDecorationOnUnfold: true,
    buildDecorations: (state, node, selectionTouchesRange) => {
      let imageUrl: string | undefined;
      let alt = "";
      iterChildren(node.node.cursor(), (node) => {
        if (node.name === "URL") {
          imageUrl = state.doc.sliceString(node.from, node.to);
        } else if (node.name !== "ImageMark") {
          alt += state.doc.sliceString(node.from, node.to);
        }

        return undefined;
      });

      if (imageUrl) {
        const line = state.doc.lineAt(node.from);
        const block = node.from == line.from && node.to == line.to;
        const resolvedUrl = resolveMarkdownImageSrc(imageUrl, state.facet(markdownImageOptionsFacet)) ?? imageUrl;
        const widget = new ImageWidget(resolvedUrl, alt.trim() || undefined, block);

        if (selectionTouchesRange) {
          return Decoration.widget({
            widget,
            block,
          }).range(node.to, node.to);
        } else {
          return Decoration.replace({
            widget,
            block,
          }).range(node.from, node.to);
        }
      }
    },
  }),
  selectAllDecorationsOnSelectExtension("cm-image"),
];
