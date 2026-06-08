# Migrating our Pierre diff surface to `CodeView`

Task-prep doc. Status: **draft (pre-grill)**. Front-half only — no feature code yet.

## Goal & success criteria

Replace our hand-rolled diff-review virtualization (`DiffEditor` + `DiffFileSection` +
`HunkReview` + `diff-viewer-model.ts`) with Pierre's `CodeView` component — the
virtualization-first single-scroll-container surface that already ships in the
`@pierre/diffs@1.2.7` we have installed.

**Done means, observably:**
1. The Review Changes panel (Cmd+Shift+R) and Hunk Review render through one `<CodeView>` per
   surface instead of N `<FileDiff>`/`<PatchDiff>` mounted inside our own window math.
2. Large single files no longer mount every line — intra-file line-range virtualization is on
   (today we only window *between* files).
3. Scroll position, sticky headers, line selection, and annotations behave at least as well as
   today, with no blanking on fast scroll.
4. `diff-viewer-model.ts` (369 lines of custom layout/anchor/window math) is deleted or reduced
   to a thin adapter.
5. Net renderer LOC for the diff surface drops substantially (rudu does the whole thing in one
   ~360-line component).

## Research conclusion (Phase 1 — the design driver)

**What I checked, and when:**
- **Pierre's own article** "On Rendering Diffs" (pierre.computer/writing/on-rendering-diffs) —
  announces **`CodeView`**, "a virtualization-first component for reviewing code and diffs… the
  missing layer that could manage an entire review surface and handle the hard problems related
  to scale." It owns virtualization, layout reconciliation, scroll anchoring, sticky headers,
  selection, target-based scrolling, inverse-sticky anti-blanking, element pooling, paged scroll
  scaffold, append-only updates.
- **Our installed `@pierre/diffs@1.2.7`** (latest stable; 1.3.0-beta exists) — **already exports
  `CodeView`, `CodeViewHandle`, `CodeViewProps`, `CodeViewCoordinator`, `CodeViewItem`,
  `CodeViewScrollTarget`, `CodeViewLineSelection`** from both `@pierre/diffs` and
  `@pierre/diffs/react`. Verified by reading `node_modules/@pierre/diffs/dist/react/CodeView.d.ts`.
  **We do not need to upgrade. We ship the component and don't use it.**
- **rudu (`tanvesh01/rudu`, indexed in nia)** — the OSS reference, "rendering diffs with Pierre
  components." Its *entire* review surface is one ~360-line component,
  `src/components/patch-viewer/patch-code-view.tsx`, built on `CodeView`. (See pattern below.)
- **Convergence signal:** Pierre's article + rudu both land on `CodeView` for exactly this
  surface. Our own `diff-viewer-model.ts:240` even comments "(hunk/rudu pattern)" — the team
  knew the references and hand-rolled the windowing anyway. Secondary references (modem/`hunk`,
  the OpenClaw-maintainer review tool) point the same way; not load-bearing for the decision.

**The one fact that drives the design:** `CodeView` is the supported API for a multi-file diff
review surface, it already does line-range (intra-file) virtualization + anti-blanking + scroll
anchoring + selection, and **we already have it installed**. Our custom layer reimplements a
subset of it, worse.

### The reference pattern (rudu `patch-code-view.tsx`, verbatim shape)

```tsx
const items = useMemo<CodeViewItem<PatchLineAnnotation>[]>(
  () => files.map((file) => ({
    id: getCodeViewItemId(file.fileDiff.name),
    type: "diff",
    fileDiff: file.fileDiff,            // FileDiffMetadata from parsePatchFiles
    annotations: buildLineAnnotations(file),
    version: buildCodeViewVersion(file), // hash → controlled re-render of just this item
  })),
  [files],
);

<CodeView
  ref={codeViewRef}                     // imperative handle: scrollTo, setSelectedLines, addItems…
  items={items}                          // controlled mode
  options={options}                      // theme, diffStyle, lineDiffType, stickyHeaders, itemMetrics…
  renderAnnotation={renderAnnotation}    // comment threads in annotation slots
  renderHeaderMetadata={renderHeaderMetadata}
  selectedLines={selectedLines}          // controlled selection → comment composer
/>
```

`CodeView` internally owns: per-item `VirtualizedFileDiff`/`VirtualizedFile`, the worker pool,
element pooling, sticky container, scroll anchoring, `scrollTo({item|line|range|position})`.

## Current state — what we built, and the concrete problems

| Our file | LOC | What it does |
|----------|-----|--------------|
| `DiffEditor.tsx` | 1056 | Working-tree review surface; manual window + scroll + load queue |
| `DiffFileSection.tsx` | 965 | Per-file `<FileDiff>`/`<PatchDiff>`, selection→Pierre range mapping, hunk accept/reject |
| `HunkReview/HunkReview.tsx` | 1277 | Hunk review drawer; second copy of the same window/scroll machinery |
| `diff-viewer-model.ts` | 369 | `buildDiffFileVirtualLayout`, `getVirtualDiffFileWindow`, scroll-anchor capture/restore, binary-search layout |
| **total custom surface** | **~3667** | vs rudu's **~360** on `CodeView` |

**Concrete problems (numbered, specific — not "it's messy"):**

1. **File-level windowing only.** `getVirtualDiffFileWindow` (diff-viewer-model.ts:279) windows
   *between* files. Once a file enters the window its **whole** `<FileDiff>` mounts — every line.
   A single 5k-line file = 5k mounted rows. `CodeView` does intra-file line-range rendering with
   binary search; this is the headline scale win we're leaving on the table.
2. **Height estimation is a guess we maintain by hand.** `estimateDiffFileHeight`
   (diff-viewer-model.ts:77) multiplies line counts by magic constants (`DIFF_ROW_HEIGHT = 24`,
   etc.) then we patch with measured heights. Wrong estimates cascade into scroll jumps.
   `CodeView` does incremental measured deltas + scroll anchoring internally.
3. **Two divergent copies of the same machinery.** `DiffEditor` and `HunkReview` each
   re-implement window building, scroll anchor capture/restore, and a `pumpFileDiffQueue` loader.
   Bugs fixed in one drift from the other.
4. **Manual scroll anchoring** (`captureDiffScrollAnchor`/`restoreDiffScrollTop`) instead of
   `CodeView`'s built-in anchor preservation across measure/resize — a known source of jump bugs.
5. **No anti-blanking strategy.** We have overscan px; Pierre's inverse-sticky + paged scaffold
   is the actual solution for fast-scroll blanking on tall diffs.
6. **Selection / annotation plumbing is bespoke.** `PierreSelectedRange`, `normalizeDiffSelection`,
   `pendingRangeToPierreSelection` translate to/from per-`FileDiff` `LineSelectionManager`.
   `CodeView` exposes one `selectedLines`/`onSelectedLinesChange` + `renderAnnotation` across all
   items — most of this adapter code disappears.

**Why we ended up here (best read):** CodeView likely didn't exist (or wasn't stable) when this
was first built, so the team hand-rolled file-level windowing and left the "hunk/rudu pattern"
comment as a breadcrumb. It works, but it's a maintenance tax and caps us at file-level scale.

## Scope / non-goals

- **In scope:** the two review surfaces (`DiffEditor`/Review Changes, `HunkReview`) and their
  shared `diff-viewer-model.ts`.
- **Non-goals (do not touch):** the compact non-Pierre previews (`DiffPreview/diff-model.ts`,
  `ConductorDiffBody.tsx`, `CompactDiffPreview.tsx` — these intentionally don't use Pierre); the
  custom theme (`codex-absolutely-dark`) and `registerPierreThemes`; `@pierre/trees` FileTree;
  hunk accept/reject git-patch mapping (`git-hunk-patch.ts`) which sits below the render layer.
- **Bridge to preserve:** annotation persistence (`annotation-service.ts` / review DB), the
  Cmd+Shift+R selectable-human-comments contract, hunk accept/reject buttons, and our header
  metadata/badges.

## Open questions for grilling (Phase 3)

- Migrate both surfaces at once, or `DiffEditor` first behind the existing UI, `HunkReview` second?
- `CodeView` is one scroll container for *all* files. Today we lazy-load patches per file via
  `pumpFileDiffQueue` (`ensureFileDiffLoaded`). Does `CodeView` + `addItems`/append-only let us
  keep progressive load, or do we need all `FileDiffMetadata` parsed up front? (rudu parses
  patches in a worker — `pierre-patch-parser-worker.ts` — and hands `CodeView` ready items.)
- Do our hunk accept/reject hunk-start annotations map onto `CodeView`'s `renderAnnotation` +
  `renderGutterUtility`, or do they need a custom header slot?
- Does collapsing files (our `collapsedFilePaths`) have a `CodeView` equivalent, or do we drop
  collapsed items from `items` and rely on sticky headers?
- Per-tab persistent mount / scroll restoration across tab switches — does `CodeViewHandle`
  `scrollTo` + controlled `selectedLines` cover it, or keep mounting?

## Verification (to fill after plan locks)

- `bun run build 2>&1 | tail -40`
- `bun run test:review:e2e` (e2e/hunk-review.spec.ts)
- `bunx playwright test e2e/file-editor.spec.ts --project=electron`
- Manual: large-file diff scroll (no blanking), sticky headers, select→comment, hunk
  accept/reject, tab-switch scroll restore.
