import { describe, expect, it } from "bun:test";
import type { GitFileStatusRow } from "./git-turn-delta";
import {
  classifyEndKind,
  diffStatusSnapshots,
  pathRowsSignature,
} from "./git-turn-delta";

function row(p: Partial<GitFileStatusRow> & Pick<GitFileStatusRow, "path" | "status">): GitFileStatusRow {
  return { staged: false, ...p };
}

describe("pathRowsSignature", () => {
  it("is stable for row order", () => {
    const a: GitFileStatusRow[] = [
      row({ path: "x.ts", status: "modified", staged: true }),
      row({ path: "x.ts", status: "modified", staged: false }),
    ];
    const b: GitFileStatusRow[] = [
      row({ path: "x.ts", status: "modified", staged: false }),
      row({ path: "x.ts", status: "modified", staged: true }),
    ];
    expect(pathRowsSignature(a)).toBe(pathRowsSignature(b));
  });
});

describe("classifyEndKind", () => {
  it("prefers deleted when present", () => {
    expect(
      classifyEndKind([
        row({ path: "a", status: "modified" }),
        row({ path: "a", status: "deleted", staged: true }),
      ]),
    ).toBe("deleted");
  });

  it("treats untracked as created", () => {
    expect(classifyEndKind([row({ path: "a", status: "untracked" })])).toBe("created");
  });

  it("treats added as created", () => {
    expect(classifyEndKind([row({ path: "a", status: "added", staged: true })])).toBe("created");
  });

  it("defaults to modified", () => {
    expect(classifyEndKind([row({ path: "a", status: "renamed", staged: true })])).toBe("modified");
  });
});

describe("diffStatusSnapshots", () => {
  it("returns empty when identical", () => {
    const s: GitFileStatusRow[] = [row({ path: "a.ts", status: "modified" })];
    expect(diffStatusSnapshots(s, s)).toEqual([]);
  });

  it("clean to dirty lists path as created when untracked", () => {
    const after: GitFileStatusRow[] = [row({ path: "new.txt", status: "untracked" })];
    expect(diffStatusSnapshots([], after)).toEqual([{ path: "new.txt", kind: "created" }]);
  });

  it("clean to dirty lists modified", () => {
    const after: GitFileStatusRow[] = [row({ path: "a.ts", status: "modified" })];
    expect(diffStatusSnapshots([], after)).toEqual([{ path: "a.ts", kind: "modified" }]);
  });

  it("omits paths that returned to clean", () => {
    const before: GitFileStatusRow[] = [row({ path: "a.ts", status: "modified" })];
    expect(diffStatusSnapshots(before, [])).toEqual([]);
  });

  it("detects dirty to dirtier", () => {
    const before: GitFileStatusRow[] = [row({ path: "a.ts", status: "modified", staged: false })];
    const after: GitFileStatusRow[] = [
      row({ path: "a.ts", status: "modified", staged: false }),
      row({ path: "a.ts", status: "modified", staged: true }),
    ];
    expect(diffStatusSnapshots(before, after)).toEqual([{ path: "a.ts", kind: "modified" }]);
  });

  it("skips unchanged dirty file", () => {
    const same: GitFileStatusRow[] = [
      row({ path: "a.ts", status: "modified", staged: true }),
      row({ path: "a.ts", status: "modified", staged: false }),
    ];
    expect(diffStatusSnapshots(same, [...same])).toEqual([]);
  });

  it("sorts paths", () => {
    const after: GitFileStatusRow[] = [
      row({ path: "z.ts", status: "modified" }),
      row({ path: "a.ts", status: "added", staged: true }),
    ];
    const d = diffStatusSnapshots([], after);
    expect(d.map((x) => x.path)).toEqual(["a.ts", "z.ts"]);
  });
});
