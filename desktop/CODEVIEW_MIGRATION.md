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
- **rudu (`tanvesh01/rudu`, indexed in nia — verified by reading the source)** — the OSS
  reference, "rendering diffs with Pierre components." Its *entire* review surface is one
  366-line component, `src/components/patch-viewer/patch-code-view.tsx`, built on `CodeView`.
  Parsing is a separate concern in `src/hooks/usePatchParsing.ts` +
  `src/pierre-patch-parser-worker.ts`. (Verbatim shape + mechanics below.)
- **Convergence signal:** Pierre's article + rudu both land on `CodeView` for exactly this
  surface. Our own `diff-viewer-model.ts:240` even comments "(hunk/rudu pattern)" — the team
  knew the references and hand-rolled the windowing anyway.
- **Secondary references — honest status:** modem/`hunk` and the OpenClaw-maintainer review tool
  were **not** deeply verified this pass. `nia repos index modemdem/hunk` returned 400 (wrong
  slug / private / moved); `nia github search` only searches *within* a named repo, so the
  OpenClaw tool couldn't be discovered without its owner/repo. There is a locally-installed
  `hunk-review` skill that drives live "Hunk" diff sessions, which is consistent with the same
  CodeView-shaped direction. **Not load-bearing** — the decision rests on the article + rudu +
  our own installed type defs, all three confirmed.

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

**Verified mechanics from rudu's source (these become our crib sheet):**

- **Parsing is decoupled from rendering and runs in a worker.** `usePatchParsing.ts` does
  `parsePatchFiles(trimPatchContext(patch, 3), cacheKeyPrefix).flatMap(p => p.files)` →
  `FileDiffMetadata[]`. It runs that inside `pierre-patch-parser-worker.ts?worker`, with a
  **main-thread fallback** if the worker fails to construct or errors. `parsePatchFiles` (not
  `parseDiffFromFile`/`getSingularPatch`) is the builder. → *We already import the building
  blocks; this is the function we standardize on.*
- **Controlled `items`, one per file**, each `{ id, type:"diff", fileDiff, annotations, version }`.
  `version` is a cheap **hash** of `cacheKey + addition/deletion line counts + an annotation
  signature + the draft signature` (`buildCodeViewVersion`) so only the *changed* item re-renders.
- **Selection is fully controlled**: `selectedLines = { id, range:{start,side,end,endSide} }`;
  `options.onGutterUtilityClick(range, ctx)` opens the comment draft;
  `enableLineSelection:true` + `enableGutterUtility:true`.
- **Annotations**: `buildLineAnnotations(file)` = persisted review threads **+** an in-flight
  draft annotation, fed to one `renderAnnotation(annotation, item)`. `renderHeaderMetadata(item)`
  draws per-file badges. One callback set spans all files — no per-`FileDiff` manager.
- **Layout estimate is declarative**: `options.itemMetrics = { hunkLineCount, lineHeight,
  diffHeaderHeight, hunkSeparatorHeight, spacing }` + `stickyHeaders:true`. CodeView refines with
  measured deltas internally — replacing our hand-maintained `estimateDiffFileHeight` constants.

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

## Decisions resolved by research (folded out of "open questions")

| Was an open question | Resolution (grounded) |
|----------------------|------------------------|
| Progressive load vs parse-up-front | **Two layers, decoupled.** Render virtualization is CodeView's job — it only mounts visible *lines* across one container, so "parse everything" no longer means "render everything." Keep our per-file **patch fetch** (`ensureFileDiffLoaded`) but feed results via `codeViewRef.addItems()` (append-only) as patches arrive. rudu parses the *whole* patch once in a worker; we keep incremental fetch + worker-parse each fetched patch with `parsePatchFiles`. The `pumpFileDiffQueue` **render** windowing is deleted; the fetch queue stays. |
| Where parsing runs | **Worker, main-thread fallback** — copy rudu's `usePatchParsing` + `pierre-patch-parser-worker.ts` shape. We already wrap a worker pool in `DiffEditor` (`WorkerPoolContextProvider`/`createPierreDiffWorker`); CodeView owns the *highlight* worker pool itself, so our pool wrapper likely goes too. |
| Height estimation | **Delete `estimateDiffFileHeight` + magic constants.** Replace with declarative `options.itemMetrics` + CodeView's measured deltas. |
| Selection/annotation adapter | **Most of it disappears.** One controlled `selectedLines` + `onSelectedLinesChange` + `renderAnnotation` across all items replaces `PierreSelectedRange`/`normalizeDiffSelection`/`pendingRangeToPierreSelection` and the per-`FileDiff` `LineSelectionManager` plumbing. |
| Re-render granularity | **Per-item `version` hash** (rudu's `buildCodeViewVersion`) — hash cacheKey + add/del counts + annotation signature + draft signature. |

## Open questions for grilling (Phase 3 — genuine judgment calls left)

1. ~~**Sequencing.**~~ **DECIDED (grill): one-shot.** Convert `DiffEditor` *and* `HunkReview` to
   CodeView and delete `diff-viewer-model.ts`, the `pumpFileDiffQueue` render path, and the
   `WorkerPoolContextProvider` wrapper in a **single PR**. Cleaner end state, no interim fork of a
   shared model. Blast radius is real → the test matrix below (e2e on both surfaces + large-file
   scroll) is the safety net, not a staged rollback. Risk accepted by owner.
2. ~~**Hunk accept/reject.**~~ **RESOLVED by reading our own code.** Accept/reject is *already*
   a Pierre annotation, not bespoke chrome: `getHunkActionLineKey(hunk)` mints a sentinel
   `DiffLineAnnotation` at each hunk's start line, `HunkActionAnnotation` renders it in the
   annotation slot, and it's merged with comment annotations in the same `renderAnnotation` path
   (`DiffFileSection.tsx:381,405,591`). That is the *identical* mechanism rudu uses to inject its
   draft annotation (`buildLineAnnotations` → per-item `annotations[]` → `renderAnnotation`). So
   under CodeView: inject the hunk-action annotations into each item's `annotations[]`, render
   them in the shared `renderAnnotation`. The git mutation (`diffAcceptRejectHunk(fileDiffState,
   hunkIndex, …)` + `GitHunkActionRequest`) sits *below* the render layer — untouched. On
   accept/reject we produce a new `fileDiff` for that one item and bump its `version` (rudu's
   controlled-update path). **No custom header needed; this was the scary item and it's low-risk.**
3. ~~**Collapsed files.**~~ **RESOLVED by reading the type defs.** `CodeViewDiffItem` and
   `CodeViewFileItem` both carry a native `collapsed?: boolean` (`@pierre/diffs` `types.d.ts:358,
   366`; also `collapsedContextThreshold`). Our `collapsedFileOverrides` / `autoCollapseFiles`
   (`DiffEditor.tsx:106,319`) maps straight onto `item.collapsed` — no dropping items, no feature
   loss, no reliance on rudu (which has no collapse).
4. ~~**Per-tab mount / scroll restore.**~~ **DECIDED (default, low-stakes):** keep one persistent
   `<CodeView>` mount per diff tab, persist `scrollTop` per tab via `onScroll`, restore on mount
   with `CodeViewHandle.scrollTo({ type:"position" })`; restore selection via controlled
   `selectedLines`. Mirrors today's capture/restore but uses CodeView's own anchor-stable scroll.
   Owner may revisit if tab-switch jank appears.
5. ~~**Worker-pool ownership.**~~ **RESOLVED by type defs.** CodeView owns its highlight worker
   pool (`WorkerPoolManager`) internally and exposes `disableWorkerPool`. So we **delete** our
   `WorkerPoolContextProvider` wrapper + `createPierreDiffWorker` highlight pool, and **add** a
   *patch-parser* worker (rudu's `pierre-patch-parser-worker.ts` shape) — a different worker, for
   `parsePatchFiles`, not highlighting. Net: one wrapper out, one small parser worker in.

**All five open questions are now resolved. Plan is locked.**

## Verification (to fill after plan locks)

- `bun run build 2>&1 | tail -40`
- `bun run test:review:e2e` (e2e/hunk-review.spec.ts)
- `bunx playwright test e2e/file-editor.spec.ts --project=electron`
- Manual: large-file diff scroll (no blanking), sticky headers, select→comment, hunk
  accept/reject, tab-switch scroll restore.
