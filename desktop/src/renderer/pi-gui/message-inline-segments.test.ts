import { describe, expect, it } from "bun:test";
import { segmentMessageForInlineChips } from "./message-inline-segments";

describe("segmentMessageForInlineChips", () => {
  it("segments repo-relative .txt and .csv paths (demo / data files)", () => {
    const s = segmentMessageForInlineChips(
      "- demo/random-artifacts/banana-orbit.txt\n- demo/random-artifacts/wizard-invoice.csv\n- demo/random-artifacts/toast-thoughts.md",
    );
    const files = s.filter((x) => x.kind === "file");
    expect(files.length).toBe(3);
    expect(files.map((f) => (f.kind === "file" ? f.path : "")).sort()).toEqual(
      [
        "demo/random-artifacts/banana-orbit.txt",
        "demo/random-artifacts/toast-thoughts.md",
        "demo/random-artifacts/wizard-invoice.csv",
      ].sort(),
    );
  });

  it("segments absolute file path and relative path with extension", () => {
    const s = segmentMessageForInlineChips(
      "Edit /Users/tri-boardy/constellagent/desktop/src/renderer/pi-gui/pi-gui-constellagent-bridge.css for theme.",
    );
    const files = s.filter((x) => x.kind === "file");
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]?.kind).toBe("file");
    if (files[0]?.kind === "file") {
      expect(files[0].path).toContain("pi-gui-constellagent-bridge.css");
    }
  });

  it("classifies SKILL.md paths as skillFile", () => {
    const s = segmentMessageForInlineChips(
      "Path: /Users/tri-boardy/.claude/skills/emil-design-eng/SKILL.md for reference.",
    );
    const skillFiles = s.filter((x) => x.kind === "skillFile");
    expect(skillFiles.length).toBe(1);
    expect(skillFiles[0]?.kind).toBe("skillFile");
    if (skillFiles[0]?.kind === "skillFile") {
      expect(skillFiles[0].path).toContain("SKILL.md");
    }
  });

  it("segments slash skills as skillSlash, not file", () => {
    const s = segmentMessageForInlineChips("Try /nia for search or /summarize for transcripts.");
    const skills = s.filter((x) => x.kind === "skillSlash");
    expect(skills.map((x) => (x.kind === "skillSlash" ? x.name : ""))).toEqual(["nia", "summarize"]);
    expect(s.some((x) => x.kind === "file" && x.path === "/nia")).toBe(false);
  });

  it("does not chip inside fenced code blocks", () => {
    const s = segmentMessageForInlineChips("```\n/Users/foo/bar.ts\n```\nAlso /Users/out.ts");
    expect(s.some((x) => x.kind === "text" && x.text.includes("/Users/foo/bar.ts"))).toBe(true);
    expect(s.some((x) => x.kind === "file" && x.path.includes("foo"))).toBe(false);
    expect(s.some((x) => x.kind === "file" && x.path.includes("/Users/out.ts"))).toBe(true);
  });

  it("does not chip inside inline backticks", () => {
    const s = segmentMessageForInlineChips("see `desktop/src/foo.ts` and desktop/src/bar.ts");
    expect(s.some((x) => x.kind === "text" && x.text.includes("desktop/src/foo.ts"))).toBe(true);
    expect(s.some((x) => x.kind === "file" && x.path.includes("foo.ts"))).toBe(false);
    expect(s.some((x) => x.kind === "file" && x.path.includes("bar.ts"))).toBe(true);
  });
});
