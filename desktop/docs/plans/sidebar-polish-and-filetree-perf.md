# Sidebar polish + file-tree load perf

Task-prep output. Three changes: (A) workspace box → match mockup rectangle, (B) fix
✕/branch-icon collision, (C) project bar → match mockup, (D) speed up file-tree load.

Source of truth for all UI sizing: **`desktop/sidebar-rudu-port-mockup.html`** (the rudu port
the current sidebar was built from). The live CSS drifted from it; we re-converge.

## Research conclusion

- **Mockup is authoritative.** `.wsBar` = `padding:8px 10px 9px 26px; border-radius:8px`, faces
  `gap:3px`, two compact rows (topline `min-height:15px` + mainline) → a ~50px **rectangle**.
  The live `.workspaceItem` is `display:flex; align-items:flex-start; padding:8px 12px` with
  `.wsFace gap:var(--space-1)` → taller/squarer. (mockup L98–99, L124, L131, L147)
- **Collision cause:** the mockup has exactly two right-edge buttons, both vertically centered —
  `.del{right:9px; top:50%}` and `.flip{right:37px; top:50%}` (mockup L163–174). The live build
  added a **third** element, `BranchAndPrLauncher`/`.branchPrBtn` (`right:32px`, **no `top`**),
  and `.deleteBtn` lost its `top:50%`. Two un-centered buttons float to the static top-right and
  the orange git-branch icon lands on the ✕. (live CSS L362–381 deleteBtn, L388–409 branchPrBtn)
- **Project bar** already has the right parts (`.glyphSlot`, `.repoName` w/ owner, settings/PR/
  sync/delete buttons) but drifted: `padding:var(--space-3) 116px … var(--space-6)`, `gap:space-3`,
  uppercase. Mockup `.projectHeader`: `gap:9px; padding:7px 9px`, `.repoName .owner` muted + repo
  bright (not uppercase), `.hdrActions{display:flex; gap:2px}` 22×20 buttons hover-revealed with
  staggered delay. (mockup L46–88; Image #3 confirms ⚙ · PR · ↻ · ✕)
- **File-tree perf — measured on this repo (1500 files), git is NOT the bottleneck:**
  `git ls-files` 48ms · `git status -uall` ~20ms · `buildTreeFromPaths` 13ms · tree JSON 309KB ·
  and a **redundant** `collectAlwaysVisibleFiles` full recursive `fs.readdir` walk = 26ms
  (scales with repo size). Each is fast once; the problem is they run **eagerly on every fetch
  with no cache** (every workspace switch / panel open re-pays git + walk + 309KB IPC + full
  Pierre `resetPaths`), plus the redundant second filesystem walk. (`file-service.ts`
  getTree L132, getGitTree L181, collectAlwaysVisibleFiles L238; `ipc.ts` FS_GET_TREE_WITH_STATUS L826)
- **Pierre `@pierre/trees` is path-list based** (`FileTreeController(paths[])` + `resetPaths` +
  batch add/remove/move; render-side virtualization only). There is **no async lazy-load-children
  hook**. Industry lazy-per-directory loading (nia top hit: Spacedrive `directory_listing` +
  tanstack virtualizer) would mean fighting Pierre's model and re-architecting its git-status and
  search, which both assume the full path set. → **Decision below: optimize + cache, not lazy.**

## Locked decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | WS box shape | Re-converge `.workspaceItem`/`.wsFaces`/`.wsFace` to mockup `.wsBar`/`.faces`/`.face`: `padding:8px 10px 9px 26px`, `border-radius:8px`, face `gap:3px`, topline `gap:7px`, mainline `gap:8px`. Drop `align-items:flex-start`; box is `position:relative` padding around the grid, not a flex row. |
| 2 | Button collision | All right-edge controls get `top:50%; transform:translateY(-50%)`. Lay out as a single right-anchored cluster: `.deleteBtn right:9px`, `.wsFlip right:37px`, and **`.branchPrBtn` right:65px** (one 28px slot further left, only present when on default branch w/ changes). No two controls share a horizontal slot. |
| 3 | Branch launcher | Keep `BranchAndPrLauncher` (it's real functionality not in the mockup) but slot it leftmost in the cluster + vertically center it; it already hover-reveals via `:focus-within`/hover. |
| 4 | Project header | Match mockup: `gap:9px; padding:7px 9px`, remove `text-transform:uppercase`/`letter-spacing`, `.repoName .owner` → `var(--text-tertiary)`/muted + repo name `var(--text-primary)`. Replace the `116px` reserved right padding + absolute action buttons with an inline `.hdrActions` flex cluster (`gap:2px`, 22×20 buttons) that hover-reveals with the staggered `nth-child` delays from mockup L85–88. Order: ⚙ settings · PR · ↻ sync · ✕ delete. |
| 5 | Perf approach | **Optimize + cache the eager full-tree load. Do NOT switch to lazy per-directory** (Pierre can't, and caching captures most of the win at a fraction of the risk). Lazy-load = documented non-goal. |
| 6 | Redundant walk | Replace `collectAlwaysVisibleFiles` (full recursive `fs.readdir`) with one extra git call: `git ls-files --others --ignored --exclude-standard` filtered to `isAlwaysVisibleFileName`, run in the existing `Promise.all` alongside `ls-files`. Removes a whole filesystem traversal; same visible-files result. |
| 7 | Cache | Add a per-workspace tree+status cache in `FileService` keyed by normalized root, invalidated by the existing file-watcher (`useFileWatcher`/fs change events). Re-showing a panel / switching back to a workspace returns the cached snapshot instantly; a debounced background refresh reconciles. |
| 8 | Renderer incremental | When a refresh returns a tree for a workspace Pierre already has, diff to batch `add`/`remove` (or `resetPaths` if cheaper) instead of tearing down + rebuilding the controller, so expansion/scroll state survives and large repos don't re-layout from scratch. |

## File changes

| File | Change |
|------|--------|
| `desktop/src/renderer/components/Sidebar/Sidebar.module.css` | `.workspaceItem`/`.wsFaces`/`.wsFace` dims (dec 1); `.deleteBtn`/`.wsFlip`/`.branchPrBtn` centering + right offsets (dec 2,3); `.projectHeader`/`.repoName`/`.hdrActions` (dec 4) |
| `desktop/src/renderer/components/Sidebar/Sidebar.tsx` | Wrap the project action buttons in an inline `.hdrActions` cluster; owner/repo span split if not already (dec 4) |
| `desktop/src/main/file-service.ts` | Replace `collectAlwaysVisibleFiles` body w/ git-ignored-files call (dec 6); add per-root tree/status cache + invalidation hook (dec 7) |
| `desktop/src/main/ipc.ts` | `FS_GET_TREE_WITH_STATUS` reads cache first; wire watcher-driven invalidation (dec 7) |
| `desktop/src/renderer/components/RightPanel/FileTree.tsx` + `file-tree-adapter.ts` | Incremental snapshot diff → Pierre batch ops instead of full rebuild (dec 8) |

## Exhaustive case coverage

| Case | Behavior |
|------|----------|
| WS on default branch w/ changes | branchPrBtn shown @ right:65px, centered; ✕ @9px, flip @37px — no overlap |
| WS not on default branch | no branchPrBtn; only flip@37 + del@9 (matches mockup exactly) |
| Hover reveal | all cluster buttons fade/scale in centered; staggered like mockup |
| PR mode vs local mode | unchanged crossfade; box height identical in both faces (no reflow) |
| Project header collapsed/expanded | chevron rotates; actions still hover-reveal |
| Long owner/repo name | repoName ellipsis truncates, actions cluster stays pinned right |
| File tree, first open | full load (git + git-ignored call), cached after |
| File tree, switch away + back | cache hit → instant; bg refresh reconciles |
| File tree, file changes on disk | watcher invalidates cache → next show / live refresh shows change |
| Gitignored `.env`/`.env.local` | still visible via git-ignored-files call (no fs walk) |
| Non-git folder | getGitTree throws → existing fallback `getTree` manual walk (unchanged) |
| Empty repo | empty path list → empty tree (unchanged) |

## Test matrix

- **Unit** `file-service.test.ts` (bun): always-visible files (tracked `.gitignore`, ignored `.env.local`)
  appear in tree without the fs walk; cache returns same snapshot on 2nd call; invalidation forces recompute.
- **E2e** `e2e/file-editor.spec.ts -g "file tree"` (`bun run verify:files-panel`): tree renders,
  expand state survives a workspace switch.
- **Manual:** hover a workspace row on default branch → ✕, flip, branch icon all visible, vertically
  centered, no overlap (the Image #2 bug). Box reads as a rectangle (Image #1). Project header matches
  Image #3 (⚙ PR ↻ ✕, muted owner). Switch workspaces repeatedly → tree re-shows instantly.

## Verification

```bash
bun test desktop/src/main/file-service.test.ts 2>&1 | tail -20
bun run --cwd desktop verify:files-panel 2>&1 | tail -20
bun run build 2>&1 | tail -20
```
Then `bun run dev` and eyeball against Images #1–3 + the mockup.

## Risks / notes

- **Cache staleness:** must hook the *existing* watcher; a missed invalidation = stale tree. Keep a
  short TTL + manual refresh as backstop. Surface, don't hide.
- **`git ls-files --others --ignored`** can be large if a huge dir is gitignored; filter to
  always-visible basenames *before* building, and cap. Log if truncated.
- **branchPrBtn right:65px** assumes the cluster never exceeds 3 buttons; if a 4th control is added,
  revisit offsets (or switch the cluster to flex like the project header).
- Main-process changes (`file-service.ts`, `ipc.ts`) need a full **⌘Q + `bun run dev`**, not just ⌘R.
