import { describe, expect, it } from "bun:test";
import type { TranscriptMessage } from "@shared/pi/timeline-types";
import { aggregateWriteToolFileSections, aggregateWriteToolStats } from "./write-tools-aggregate";

function msg(
  id: string,
  role: "user" | "assistant",
  text: string,
): Extract<TranscriptMessage, { kind: "message" }> {
  return {
    kind: "message",
    id,
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

function writeTool(
  callId: string,
  path: string,
  content: string,
): Extract<TranscriptMessage, { kind: "tool" }> {
  return {
    kind: "tool",
    id: callId,
    callId,
    toolName: "write",
    status: "success",
    label: `Ran write`,
    createdAt: new Date().toISOString(),
    input: { file_path: path, content },
    output: { type: "text", text: "ok" },
  };
}

describe("aggregateWriteToolStats", () => {
  it("returns null when transcript is empty", () => {
    expect(aggregateWriteToolStats([])).toBeNull();
  });

  it("returns null when tail has no successful write tools", () => {
    const t: TranscriptMessage[] = [
      msg("u1", "user", "hi"),
      msg("a1", "assistant", "hello"),
    ];
    expect(aggregateWriteToolStats(t)).toBeNull();
  });

  it("aggregates synthetic write diffs after last user message", () => {
    const t: TranscriptMessage[] = [
      msg("u1", "user", "do it"),
      writeTool("c1", "src/a.ts", "line1\nline2"),
      writeTool("c2", "src/b.ts", "x"),
    ];
    const s = aggregateWriteToolStats(t);
    expect(s).not.toBeNull();
    expect(s!.fileCount).toBe(2);
    expect(s!.added).toBeGreaterThan(0);
    expect(s!.removed).toBe(0);
  });

  it("sums stats for the same path across two writes", () => {
    const t: TranscriptMessage[] = [
      msg("u1", "user", "edit twice"),
      writeTool("c1", "src/x.ts", "a"),
      writeTool("c2", "src/x.ts", "a\nb"),
    ];
    const s = aggregateWriteToolStats(t);
    expect(s).not.toBeNull();
    expect(s!.fileCount).toBe(1);
    expect(s!.added).toBeGreaterThanOrEqual(2);
  });

  it("ignores messages before the last user message", () => {
    const t: TranscriptMessage[] = [
      msg("u0", "user", "old"),
      writeTool("old", "old.ts", "zzz"),
      msg("u1", "user", "new"),
      writeTool("c1", "new.ts", "only"),
    ];
    const s = aggregateWriteToolStats(t);
    expect(s).not.toBeNull();
    expect(s!.fileCount).toBe(1);
  });

  it("merges multi-file unified diff from output", () => {
    const multiDiff = `diff --git a/one.txt b/one.txt
--- a/one.txt
+++ b/one.txt
@@ -1 +1 @@
-old
+new
diff --git a/two.txt b/two.txt
--- a/two.txt
+++ b/two.txt
@@ -0,0 +1 @@
+hi
`;
    const tool: Extract<TranscriptMessage, { kind: "tool" }> = {
      kind: "tool",
      id: "p1",
      callId: "p1",
      toolName: "apply_patch",
      status: "success",
      label: "patch",
      createdAt: new Date().toISOString(),
      input: {},
      output: multiDiff,
    };
    const t: TranscriptMessage[] = [msg("u1", "user", "patch"), tool];
    const s = aggregateWriteToolStats(t);
    expect(s).not.toBeNull();
    expect(s!.fileCount).toBe(2);
    expect(s!.added).toBeGreaterThanOrEqual(2);
    expect(s!.removed).toBeGreaterThanOrEqual(1);
  });

  it("aggregateWriteToolFileSections returns paths for footer diff UI", () => {
    const t: TranscriptMessage[] = [
      msg("u1", "user", "go"),
      writeTool("c1", "src/a.ts", "x"),
      writeTool("c2", "src/b.ts", "y"),
    ];
    const sec = aggregateWriteToolFileSections(t);
    expect(sec).not.toBeNull();
    expect(sec!.length).toBe(2);
    expect(sec!.map((s) => s.path).sort()).toEqual(["src/a.ts", "src/b.ts"].sort());
  });
});
