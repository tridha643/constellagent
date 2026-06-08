# Plan — Port rudu's annotation system, box layout & UI into constellagent

**Status:** DRAFT (pre-grill). Generated via `/task-prep` (nia-grounded) + `/emil-design-eng` + `/web-animation-design`.
**Date:** 2026-06-08

---

## Phase 0 — Frame

### Goal & success criteria
Bring rudu's (`tanvesh01/rudu`) review/annotation experience into constellagent's desktop app:
1. **Comment thread cards** — threads with replies, resolve/outdated, GitHub `suggestion` blocks.
2. **Patch-viewer diff boxes** — rudu's inline diff + annotation rendering on Pierre `CodeView`.
3. **App-shell pane layout** — rudu's sidebar / diff / tabbed-right-panel composition + sliding tab indicator.
4. **Review-walkthrough group cards** — collapsible group boxes, file rows, file/line stat badges.

"Done" =
- A reviewer can create / reply-to / edit / resolve threaded comments on a diff, with `suggestion` blocks, against **either** a local working-tree diff (libSQL) **or** a GitHub PR (gh GraphQL), through **one** UI.
- The walkthrough group-card view renders for a generated walkthrough.
- Selected **human** comments still submit to the local AI agent over PTY (`formatReviewForAgent`).
- Visuals match rudu's look (ink/canvas/surface palette) re-skinned as CSS Modules + tokens, motion per Emil/animation rules.

### Current state (constellagent)
- `desktop/src/renderer/components/patch-viewer/` already mirrors rudu's structure and **also uses `@pierre/diffs`** — same diff engine, big compatibility win.
- Annotation model is **flat**: `DiffAnnotation { id, filePath, side:'additions'|'deletions', lineNumber, lineEnd?, body, rationale?, createdAt, resolved, author? }`. No replies, no `subjectType`, no `isOutdated`, no thread node identity.
- Persistence: **libSQL** via IPC (`window.api.review.commentAdd/List/Remove/Resolve`) + merges read-only **GitHub PR** review comments (`window.api.github.getPrReviewComments`). Channels: `REVIEW_COMMENT_ADD/LIST/REMOVE/RESOLVE`, `REVIEW_ANNOTATIONS_CLEARED`.
- Submission: `submitHunkReview(selectedIds?)` → `formatReviewForAgent` → agent **PTY** (bracketed paste). Human-only comments selectable via checkboxes; AI/GitHub comments display-only (per CLAUDE.md).
- Composer: **plain markdown textarea** (CSS Modules `AnnotationBubble.module.css`), no rich editor, no suggestion blocks.
- Styling: **CSS Modules + design-token CSS vars** (`--surface-1`, `--radius-sm`, `--motion-slow`…), dark mode via `class="dark"`. No Tailwind.
- State: **Zustand** (`app-store.ts`); patch parsing via main-thread + worker pool.
- Extra constellagent-only features: `HunkActionAnnotation` (stage/discard hunk), code-**tour** mode (`TourRail`, agent annotations w/ `rationale`), `variant: 'tab' | 'drawer'`, auto-collapse budget, viewed-state.

### Scope
**In:** unified thread model; dual backend (libSQL + GitHub) behind one interface; thread/reply/edit/resolve UI; suggestion blocks; walkthrough group-card view; app-shell pane re-layout + sliding tab indicator; design-token + CSS-module re-skin; motion polish; keep agent-PTY submission.

**Non-goals (this effort):** porting rudu's Rust/Tauri runtime; rudu's AI review-chat agent runtime (ACP/codex/opencode), Linear issue dashboard, repo discovery/search, the dotmatrix shader loader (nice-to-have, deferred). No change to constellagent's PTY/agent transport itself.

---

## Phase 1 — Research conclusion (nia-grounded)

**Sources checked (all via Nia, repo `tanvesh01/rudu@main`, indexed):**
- Annotation/data layer: `src/components/patch-viewer/*`, `src/components/ui/review-*`, `src/lib/review-threads.ts`, `review-thread-optimistic.ts`, `src/queries/{github,review-session}-native.ts`, `src-tauri/src/services/review_graphql.rs`, `src-tauri/src/commands/review_comments.rs`, `src-tauri/src/cache/mod.rs`.
- Layout/walkthrough: `src/components/app-shell/*`, `pull-request-workspace.tsx`, `ui/patch-viewer-main.tsx`, `ui/repo-sidebar*`, `ui/changed-files-tree.tsx`, `features/review-chat/walkthrough/view/*`.
- Design system: `tailwind.config.js`, `src/index.css`, `components.json`, `package.json`, `ui/{tooltip,dialog,select,accordion}.tsx`, dotmatrix loader.

**Driving facts:**
1. **Both apps render diffs with `@pierre/diffs`** and overlay `DiffLineAnnotation<T>` keyed by `{ side:'additions'|'deletions', lineNumber, metadata }`. The renderer seam is identical → the diff-box port is mostly model + styling, not engine.
2. rudu anchors a comment by `{ path, line, startLine, side:'LEFT'|'RIGHT', startSide, subjectType:'line'|'file' }`; threads hold ordered `ReviewComment`s; replies linked by `replyToId`; thread identity = GraphQL node `id`; `isResolved`/`isOutdated` filter active vs inactive.
3. rudu's persistence is **GitHub itself** via `gh api graphql` (`addPullRequestReviewThread`, `addPullRequestReviewThreadReply`, `updatePullRequestReviewComment`, `reviewThreads` query). **Nothing local** — SQLite caches only repos/PRs/patch text. The command layer is a testable factory `createGithubNativeCommands(invokeFn)` → **swapping Tauri `invoke` for Electron IPC is a drop-in**.
4. Optimistic UX = `@tanstack/react-query` `useMutation` with `onMutate` snapshot + pure helpers (`insertOptimisticThread`/`appendOptimisticReply`/`updateOptimisticComment`) + rollback on error + refetch on settle. constellagent today uses bespoke `AnnotationPatch` optimistic ops — react-query is **not** currently in the renderer (verify).
5. Composer is **Lexical** (`@lexical/*` + `@lexical/code-shiki`) with a custom transformer that round-trips ```` ```suggestion ```` fences. This is the heaviest dependency in the port.
6. **Layout uses NO resizable-panel lib** — plain Tailwind flex fractions (`w-1/4`, `flex-1`, `w-1/3`) + `min-w` floors. The two motion effects worth replicating: the **`Tabs.Indicator` sliding pill** (`translate-x` + `width` var, 200ms ease-in-out) and the **`grid-rows-[1fr]↔[0fr]` collapse** for cards/accordions.
7. Design tokens: `ink` scale = **Tailwind Zinc**, **inverted** for dark mode; warm-paper `canvas` `#F2F1ED`; `surface` `#F7F7F3`. Tailwind **v4** + **Base UI** (`@base-ui/react`) + **`motion`**. Popups animate **150ms ease-out, scale-95 + opacity**, accordion **200ms** grid collapse, all with `motion-reduce:transition-none`.

**Lower-confidence / to verify during impl (flagged):** whether constellagent already has `@tanstack/react-query` and any Lexical; exact libSQL schema for `review_comments`; whether constellagent's `gh` access is shelled or via Octokit.

---

## Phase 2 — Plan

### Locked decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Data model | **Dual backend, side by side.** One canonical UI model = rudu's `ReviewThread`/`ReviewComment` (threads, replies, resolve/outdated, suggestion, subjectType, optimistic). Two backends implement one `ReviewCommentApi` interface. |
| 2 | Backend selection | **Both backends are first-class and ship together (side by side).** Context selects which is active for a given diff: **working-tree / local review → `LocalReviewBackend` (libSQL/IPC)**; **GitHub PR review → `GitHubReviewBackend` (gh GraphQL via Electron main)**. Never mixed within one diff. GitHub is **not** deferred. |
| 3 | Agent submission | **Kept.** `formatReviewForAgent` + selection adapted to the thread shape: flatten thread → comments, human-authored only, honor selected IDs. Works regardless of active backend. |
| 4 | libSQL schema | Migrate `review_comments` to support threads: add `thread_id`, `reply_to_id`, `subject_type`, `start_line`, `start_side`, `is_resolved`, `is_outdated`. Backfill existing flat rows as single-comment line threads. Migration is forward-only + reversible-by-ignore (new cols nullable). Verify current schema in `desktop/src/main/ipc.ts` review handlers before writing migration. |
| 5 | Optimistic engine | **No react-query** (confirmed absent from renderer). **Hand-roll optimistic for BOTH backends** using constellagent's existing `AnnotationPatch` pattern, re-expressed over the thread model via rudu's pure helpers (`insertOptimisticThread`/`appendOptimisticReply`/`updateOptimisticComment`). Single `ReviewCommentApi` hides which backend is used. Renderer already has **framer-motion** for any JS motion. |
| 6 | Composer | **Port rudu's Lexical composer now** — full `@lexical/*` + `@lexical/code-shiki` stack, including `suggestion` block round-trip. Raw-markdown textarea remains the `requiresRawMarkdownEditor` fallback (rudu already ships this split). This is an accepted net-new dependency. |
| 7 | Styling | **Re-skin as CSS Modules + tokens** (no Tailwind added). Introduce rudu's `ink`/`canvas`/`surface` palette as constellagent CSS variables (light + inverted dark). Reproduce box recipes (`rounded-lg border bg-ink-50/80 shadow-sm`, badge `rounded-md border bg-surface`) in modules. |
| 8 | Primitives | Do **not** add `@base-ui/react`. Reimplement the two needed behaviors natively: sliding tab indicator (measure active tab, set CSS vars) and grid-rows collapse. Reuse constellagent's existing primitives elsewhere. |
| 9 | Layout | Match rudu's flex-fraction panes (sidebar `~25%` / diff `flex-1` / right tabs `~33%`, `min-w` floors). **No resizable-panel lib.** Preserve constellagent's `tab`/`drawer` variants. |
| 10 | Motion | Per Emil/animation rules: `transform`+`opacity` only; enter/exit `150ms` custom `ease-out` (`cubic-bezier(0.23,1,0.32,1)`), scale from `0.95` never `0`; tab indicator `200ms ease-in-out`; card collapse `200ms` grid-rows; buttons `:active scale(0.97)`; thread/file lists stagger `40ms`; full `prefers-reduced-motion` coverage. **No** animation on keyboard-driven toggles. |
| 11 | Staging | Ship in milestones (below); each milestone independently typechecks/tests and is reviewable. |

### Architecture — unified thread model + dual backend

```
                       ┌──────────────────────────────────────┐
   UI (ported rudu)    │  PatchCodeView (Pierre) · ThreadCard  │
                       │  Composer · WalkthroughView · Panes    │
                       └───────────────┬────────────────────────┘
                                       │ consumes
                       ┌───────────────▼────────────────────────┐
                       │   ReviewCommentApi  (one interface)     │
                       │  create·reply·update·resolve·list·viewer│
                       └───────┬───────────────────────┬─────────┘
            context: local     │                       │   context: github PR
                       ┌───────▼────────┐     ┌─────────▼─────────┐
                       │ LocalReviewBackend    │ GitHubReviewBackend│
                       │ libSQL via IPC        │ gh GraphQL via     │
                       │ (thread schema)       │ Electron main      │
                       └───────┬────────┘     └─────────┬─────────┘
                               │                        │
                  REVIEW_THREAD_* IPC          GITHUB_REVIEW_THREAD_* IPC
                               │                        │
                          main process: libSQL    main: gh api graphql
                               │
                  submitHunkReview → formatReviewForAgent → agent PTY
```

Canonical model (ported from `src/lib/review-threads.ts`):
- `ReviewComment { id; databaseId:number|null; authorLogin; authorAvatarUrl; authorAssociation; body; createdAt; updatedAt; url; replyToId:string|null; isPending?; isOptimistic? }`
- `ReviewThread { id; path; isResolved; isOutdated; line; startLine; side:'LEFT'|'RIGHT'|null; startSide; subjectType:'line'|'file'|null; comments:ReviewComment[]; isPending?; isOptimistic? }`
- `FileReviewThreads { fileThreads; lineAnnotations:DiffLineAnnotation<{thread}>[]; totalCount; unresolvedCount }`
- Side mapping unchanged: `LEFT→deletions`, `RIGHT→additions`.

### File changes

**New (renderer):**
- `patch-viewer/review-thread-model.ts` — canonical `ReviewThread`/`ReviewComment` + `buildReviewThreadsByFile`, `normalizePath` (port of rudu `review-threads.ts`).
- `patch-viewer/review-thread-optimistic.ts` — pure optimistic helpers (port).
- `patch-viewer/review-composer-state.ts` — keyed composer reducer draft/reply/edit + dirty guard (port).
- `patch-viewer/useReviewComposerSession.ts` — bridge reducer ↔ `ReviewCommentApi` (port `use-patch-review-composer-session.ts`).
- `patch-viewer/review-comment-api.ts` — the `ReviewCommentApi` interface + `useReviewCommentApi(context)` selector.
- `patch-viewer/backends/local-review-backend.ts` and `github-review-backend.ts`.
- `components/review/ReviewThreadCard.tsx` (+ `.module.css`) — thread + reply/edit composers + slim variant.
- `components/review/ReviewCommentComposer.tsx` (+ Lexical, Stage 3) and `ReviewCommentBody.tsx` (suggestion rendering via `buildSuggestionPatch` → Pierre `FileDiff`).
- `components/review/review-suggestion-seeds.ts` (port).
- `components/walkthrough/` — `WalkthroughView.tsx`, `GroupCard.tsx`, `FileRow.tsx`, `FileStatsBadge.tsx`, `HeaderFileStack.tsx`, `LineStatsText.tsx`, `file-badge-style.ts`, `stats.ts` (+ `.module.css`).
- `components/common/SlidingTabs.tsx` (+ `.module.css`) — native sliding-indicator tabs.
- `theme/rudu-tokens.css` — ink/canvas/surface palette (light + inverted dark).

**New (main process):**
- `main/review-thread-service.ts` — libSQL thread CRUD (extends existing review comment service).
- `main/github-review-service.ts` — port of `review_graphql.rs` (queries/mutations via `gh api graphql` or Octokit — verify existing approach).
- DB migration for thread columns.

**Modified:**
- `shared/diff-annotation-types.ts` → thread types; keep `DiffAnnotation` as a compatibility view if still referenced.
- `shared/ipc-channels.ts` → add `REVIEW_THREAD_*` + `GITHUB_REVIEW_THREAD_*`.
- `patch-viewer/PatchCodeView.tsx`, `patch-view-model.ts`, `PatchViewerMain.tsx` → render thread annotations + draft composer; preserve hunk-action + tour.
- `utils/review-formatter.ts` → flatten threads for `formatReviewForAgent`.
- `store/app-store.ts` → `submitHunkReview` over thread selection; persist composer/backend context.
- preload `window.api` → expose new channels.
- theme entry → import `rudu-tokens.css`; re-skin `AnnotationBubble`/`Editor`/`HunkReview` modules.

### Milestones (ship order) — walkthrough DEFERRED (see below)
- **M1 — Design tokens + box re-skin** (no behavior change): add palette tokens, re-skin existing comment cards / diff boxes / panes to rudu's look; sliding tab indicator; card collapse motion; reduced-motion. *Lowest risk, immediate visual payoff.*
- **M2 — Thread model + local backend**: schema migration, `ReviewThreadCard` with replies/resolve, `LocalReviewBackend`, hand-rolled optimistic, agent-PTY submission over threads. Composer stays textarea until M3.
- **M3 — Lexical composer + suggestions**: full `@lexical` composer, `suggestion` round-trip, `ReviewCommentBody` rendered suggestion diffs, raw-markdown fallback.
- **M4 — GitHub backend (ships with local; both side by side)**: add GraphQL review-thread commands to `desktop/src/main/github-service.ts` (gh CLI shelling — confirmed pattern), `GitHubReviewBackend`, surface-based context switch, hand-rolled optimistic for PR threads.

### Deferred & scoped — M5 Walkthrough group cards (NOT this effort)
Per grill decision: scoped now, built later. To build it later requires: (a) a walkthrough **data source** — rudu generates it via its Rust AI review-session, which is out of scope; constellagent's nearest analog is **code-tour data (agent annotations with `rationale`)**, the likely feed; (b) port `components/walkthrough/*` (GroupCard/FileRow/FileStatsBadge/HeaderFileStack/LineStatsText + `file-badge-style`/`stats`) re-skinned as CSS Modules; (c) the two motion effects (grid-rows collapse, `+N` overflow pill). UI components are fully mapped in research and can be lifted when a data source is chosen. Coverage rows 33–35 and the `GroupCard` test move with it.

### Exhaustive case coverage (contract for tests)

| Area | Case | Expected |
|---|---|---|
| Anchor | line thread, RIGHT/additions | annotation on addition line N |
| Anchor | line thread, LEFT/deletions | annotation on deletion line N |
| Anchor | multi-line `startLine..line` | range annotation, normalized order |
| Anchor | file-level (`subjectType:file`, sideless) | goes to `fileThreads`, not line annotations |
| Anchor | path with `a/`/`b/` prefix | `normalizePath` strips; matches diff path |
| Thread | reply appends under root (`replyToId=null` root) | ordered by createdAt |
| Thread | resolved thread | filtered out of active line annotations; shows in Inactive |
| Thread | outdated thread | same as resolved (inactive) |
| Thread | empty thread (no comments) | dropped |
| Edit | viewer == author | edit allowed |
| Edit | viewer != author | edit hidden |
| Edit | body needs raw markdown (`requiresRawMarkdownEditor`) | textarea fallback, not Lexical |
| Optimistic | create thread | temp id, `isPending/isOptimistic`, rollback on error, refetch on settle |
| Optimistic | reply | appended optimistically, rolled back on error |
| Optimistic | update | body replaced optimistically, rolled back on error |
| Composer | switch target while dirty | guard prompt; no silent discard |
| Composer | suggestion seed only for addition-only range | seed present; absent if any line missing |
| Backend | context=local | uses libSQL IPC; no GitHub calls |
| Backend | context=github | uses gh GraphQL; no libSQL writes |
| Backend | gh not authed / offline (github ctx) | visible error, composer restores, no crash |
| Submission | mix human + AI + GitHub comments, none selected | only human comments sent |
| Submission | explicit selection | only selected human comments sent |
| Submission | selection over a multi-comment thread | each selected human comment serialized with file+line+side |
| Hunk action | stage/discard preserved | unchanged behavior |
| Tour | agent annotations w/ rationale | tour mode unchanged |
| Walkthrough | group collapsed | header file-stack visible (grid-rows 1fr), panel hidden |
| Walkthrough | group expanded | file rows visible, header stack hidden, chevron rotated |
| Walkthrough | `+N` overflow | pill shows count when files > shown |
| Motion | `prefers-reduced-motion` | transforms disabled, opacity/color kept |
| Theme | light ↔ dark | inverted ink scale, correct contrast |

### Test matrix (colocate per repo convention, Bun test)
- `review-thread-model.test.ts` — grouping, normalizePath, side mapping, file vs line, empty-drop, resolved/outdated filtering (rows 1–9, 13–14).
- `review-thread-optimistic.test.ts` — insert/reply/update + rollback (rows 15–17).
- `review-composer-state.test.ts` — keying, dirty guard, mode transitions (rows 18, 22).
- `review-suggestion-seeds.test.ts` — addition-only seed, missing-line undefined (row 23).
- `review-formatter.test.ts` — human-only filter, selection, multi-comment thread serialization (rows 30–32).
- `local-review-backend.test.ts` / `github-review-backend.test.ts` — backend isolation + error path (rows 24–26).
- `SlidingTabs` + `GroupCard` — collapse/indicator render + reduced-motion (rows 33–35, 39).
- Migration test — flat rows backfill to single-comment threads (decision 4).

### Verification
```bash
# typecheck + lint (desktop pkg)
cd desktop && bun run typecheck && bun run lint
# unit
bun test desktop/src/renderer/components/patch-viewer
bun test desktop/src/renderer/components/walkthrough
bun test desktop/src/main/review-thread-service.test.ts
# app smoke (manual): bun run dev  → open a working-tree diff, create/reply/resolve a thread,
#   submit selected to agent; open a GitHub PR, repeat; open a walkthrough.
```

### Risks / notes (post-grill)
- **R1 (biggest, OPEN): dual-backend semantics.** Local and GitHub threads have different identity (libSQL id vs GraphQL node id) and lifecycle (no `isOutdated` locally). Mitigate: backend owns id minting; UI treats id as opaque; `isOutdated` always `false` for local; the `ReviewCommentApi` interface is the only contract the UI sees. Carry into M2/M4 as the primary regression surface.
- **R2 (RESOLVED): Lexical accepted.** `@lexical/*` + `@lexical/code-shiki` is a deliberate net-new dependency (decision 6). Watch bundle size in M3; lazy-load the editor chunk.
- **R3 (RESOLVED): no react-query.** Confirmed absent. Optimistic is hand-rolled over `AnnotationPatch` for both backends (decision 5). No new state library.
- **R4: schema migration of live `review_comments`.** Forward-only, nullable cols, backfill flat→thread; migration test + no-op path for already-migrated DBs. Confirm current schema in `ipc.ts` first.
- **R5: constellagent-only features preserved** — hunk-actions, tour mode, auto-collapse budget, viewed-state, `tab`/`drawer` variants must survive the diff-box re-skin. Regression surface for M1/M2.
- **R6 (RESOLVED): `gh` CLI shelling.** `desktop/src/main/github-service.ts` already shells `gh` (`gh pr view --json …`). GitHub backend adds `gh api graphql` thread commands there — same mechanism as rudu's `review_graphql.rs`. Low impedance.
- **R7: scope.** 4 active milestones (walkthrough deferred). M1 delivers visible value alone; each milestone independently typechecks/tests/ships. Recommend landing M1→M2 as the first PR pair, then M3/M4.

---

## Phase 3 — Grill resolutions (LOCKED)
Stress-tested via `/grill-me` + repo inspection. Resolutions folded into Locked decisions above:
1. **Data model** → dual backend, side by side (decision 1/2). Both ship; not local-first.
2. **Agent submission** → kept, adapted to threads (decision 3).
3. **Composer** → port Lexical now, full fidelity (decision 6; R2 resolved).
4. **Walkthrough** → deferred & scoped (see Deferred section); removes M5 from active scope.
5. **Backend selection** → both first-class, surface-driven context switch (decision 2).
6. **Optimistic / react-query** → none; hand-rolled (decision 5; R3 resolved).
7. **GitHub access** → `gh` CLI shelling in `github-service.ts` (R6 resolved).

**Stopping condition met:** goal precise, key branches resolved, dependencies sequenced (M1→M2→M3→M4), risks explicit (R1/R4/R5 carried as impl-time guards). Plan is **locked** and ready to implement.

## Phase 4 — Implementation (not started)
Begin at M1 against the locked plan. Write tests from the matrix; run Verification commands; `/code-review` + `/simplify` the diff before pushing.
