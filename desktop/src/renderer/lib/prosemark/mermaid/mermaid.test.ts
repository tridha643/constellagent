import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";

const renderMermaidSVGMock = mock(() =>
  '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
);

mock.module("beautiful-mermaid", () => ({
  renderMermaidSVG: renderMermaidSVGMock,
}));

const { renderMermaid, clearMermaidCache } = await import("./mermaid-renderer");

describe("renderMermaid", () => {
  beforeEach(() => {
    clearMermaidCache();
    renderMermaidSVGMock.mockClear();
    renderMermaidSVGMock.mockImplementation(() =>
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    );
  });

  test("renders valid mermaid source and returns SVG", () => {
    const result = renderMermaid("graph TD;\n  A-->B;");
    expect(result.svg).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain("<svg");
  });

  test("passes readable muted and accent tokens to beautiful-mermaid", () => {
    const source = readFileSync(new URL("./mermaid-renderer.ts", import.meta.url), "utf8");
    expect(source).toContain('muted: "var(--text-secondary');
    expect(source).toContain('accent: "var(--accent');
  });

  test("returns cached SVG on second call with same source", () => {
    const result1 = renderMermaid("graph TD;\n  A-->B;");
    expect(result1.svg).toBeDefined();

    const result2 = renderMermaid("graph TD;\n  A-->B;");
    expect(result2.svg).toBe(result1.svg);

    expect(renderMermaidSVGMock).toHaveBeenCalledTimes(1);
  });

  test("returns error result when the renderer throws", () => {
    renderMermaidSVGMock.mockImplementationOnce(() => {
      throw new Error("Parse error in mermaid");
    });

    const result = renderMermaid("not valid mermaid");
    expect(result.error).toBeDefined();
    expect(result.error).toBe("Parse error in mermaid");
    expect(result.svg).toBeUndefined();
  });

  test("handles non-Error thrown values", () => {
    renderMermaidSVGMock.mockImplementationOnce(() => {
      throw "string error";
    });

    const result = renderMermaid("bad source");
    expect(result.error).toBe("string error");
    expect(result.svg).toBeUndefined();
  });

  test("strips <script> blocks from the rendered SVG", () => {
    renderMermaidSVGMock.mockImplementationOnce(
      () =>
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>',
    );

    const result = renderMermaid("xss-script");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("alert(1)");
    expect(result.svg).toContain("<rect");
  });

  test("strips self-closing <script/> tags from the rendered SVG", () => {
    renderMermaidSVGMock.mockImplementationOnce(
      () =>
        '<svg xmlns="http://www.w3.org/2000/svg"><script src="evil.js"/><rect/></svg>',
    );

    const result = renderMermaid("xss-script-selfclosing");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("evil.js");
  });

  test("strips on*= event handler attributes from the rendered SVG", () => {
    renderMermaidSVGMock.mockImplementationOnce(
      () =>
        '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" onmouseover=\'evil()\' onload=stealCookies() /></svg>',
    );

    const result = renderMermaid("xss-handlers");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("onclick");
    expect(result.svg).not.toContain("onmouseover");
    expect(result.svg).not.toContain("onload");
    expect(result.svg).not.toContain("alert(1)");
    expect(result.svg).not.toContain("evil()");
    expect(result.svg).not.toContain("stealCookies");
    expect(result.svg).toContain("<rect");
  });
});

const { MERMAID_CANVAS_HEIGHT } = await import("./mermaid-canvas");

describe("mermaid canvas frame", () => {
  test("MERMAID_CANVAS_HEIGHT is a positive fixed integer height", () => {
    expect(MERMAID_CANVAS_HEIGHT).toBeGreaterThan(0);
    expect(Number.isInteger(MERMAID_CANVAS_HEIGHT)).toBe(true);
  });
});

const { foldExtension } = await import("../main");
const { mermaidDecorations } = await import("./mermaid-decorations");

describe("mermaidDecorations always replaces the fence", () => {
  const before = "before\n";
  const fence = "```mermaid\ngraph TD;\n  A-->B;\n```";
  const after = "\nafter";
  const doc = before + fence + after;
  const fenceFrom = before.length;
  const fenceTo = fenceFrom + fence.length;

  function makeState(selection: { anchor: number; head?: number }) {
    return EditorState.create({
      doc,
      extensions: [markdown({ extensions: [GFM] }), mermaidDecorations()],
      selection: EditorSelection.single(selection.anchor, selection.head),
    });
  }

  function fenceDecorationKind(state: ReturnType<typeof makeState>): "replace" | "widget" | "none" {
    const set = state.field(foldExtension);
    let kind: "replace" | "widget" | "none" = "none";
    set.between(0, doc.length, (from, to, deco) => {
      const spec = (deco as unknown as { spec?: { widget?: unknown } }).spec ?? {};
      if (!spec.widget) return undefined;
      if (from === fenceFrom && to === fenceTo) {
        kind = "replace";
        return false;
      }
      if (from === fenceTo && to === fenceTo) {
        kind = "widget";
        return false;
      }
      return undefined;
    });
    return kind;
  }

  test("caret outside fence → replace", () => {
    expect(fenceDecorationKind(makeState({ anchor: 0 }))).toBe("replace");
  });

  test("selection overlapping fence → still replace (no mode flip)", () => {
    expect(fenceDecorationKind(makeState({ anchor: fenceFrom + 5 }))).toBe("replace");
  });

  test("range selection covering whole fence → still replace", () => {
    expect(fenceDecorationKind(makeState({ anchor: fenceTo, head: fenceFrom }))).toBe("replace");
  });
});
