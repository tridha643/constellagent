/**
 * Compare two git porcelain status snapshots to find paths that changed during an agent turn.
 * Shape matches `GitService.getStatus` / `window.api.git.getStatus`.
 */
export interface GitFileStatusRow {
  readonly path: string;
  readonly status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  readonly staged: boolean;
}

export type TurnFileChangeKind = "modified" | "created" | "deleted";

export interface TurnPathChange {
  readonly path: string;
  readonly kind: TurnFileChangeKind;
}

function groupByPath(files: readonly GitFileStatusRow[]): Map<string, GitFileStatusRow[]> {
  const m = new Map<string, GitFileStatusRow[]>();
  for (const f of files) {
    const arr = m.get(f.path) ?? [];
    arr.push(f);
    m.set(f.path, arr);
  }
  return m;
}

/** Stable signature for one path (may be staged + unstaged rows). */
export function pathRowsSignature(rows: readonly GitFileStatusRow[]): string {
  return [...rows]
    .slice()
    .sort((x, y) => {
      const k1 = `${x.staged ? 1 : 0}\0${x.status}\0${x.path}`;
      const k2 = `${y.staged ? 1 : 0}\0${y.status}\0${y.path}`;
      return k1.localeCompare(k2);
    })
    .map((r) => `${r.staged ? "S" : "u"}:${r.status}`)
    .join("|");
}

export function classifyEndKind(rows: readonly GitFileStatusRow[]): TurnFileChangeKind {
  if (rows.some((r) => r.status === "deleted")) {
    return "deleted";
  }
  if (rows.some((r) => r.status === "untracked" || r.status === "added")) {
    return "created";
  }
  return "modified";
}

/**
 * Paths whose git status signature changed between snapshots, excluding paths that returned to clean.
 * Uses the **after** snapshot to label M / created / deleted.
 */
export function diffStatusSnapshots(
  before: readonly GitFileStatusRow[],
  after: readonly GitFileStatusRow[],
): readonly TurnPathChange[] {
  const beforeG = groupByPath(before);
  const afterG = groupByPath(after);
  const paths = new Set<string>([...beforeG.keys(), ...afterG.keys()]);
  const out: TurnPathChange[] = [];

  for (const path of paths) {
    const bRows = beforeG.get(path);
    const aRows = afterG.get(path);
    const bSig = bRows?.length ? pathRowsSignature(bRows) : "";
    const aSig = aRows?.length ? pathRowsSignature(aRows) : "";
    if (bSig === aSig) {
      continue;
    }
    if (!aRows?.length) {
      continue;
    }
    out.push({ path, kind: classifyEndKind(aRows) });
  }

  return out.sort((x, y) => x.path.localeCompare(y.path));
}
