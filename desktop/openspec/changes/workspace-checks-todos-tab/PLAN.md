# Plan — Per-workspace "Checks & Todos" tab

## Goal & success criteria
A new **per-workspace tab** (singleton, opened on demand) that shows, top-to-bottom:
1. **Checks** (screenshot 1, Checks view only): PR pill `#NNNN ↗`, a status header `X / Y checks failed`,
   a **View checks** button (opens PR `/checks` in browser), the **PR title + body**, a **Git status**
   row (`N commit(s) behind <base>`), a **Deployments** list, and a **Checks** list (pass/fail/pending
   icon + name + duration + external-link arrow per row).
2. **Your todos** (screenshot 2): header `Your todos` + `+ Add`, empty state `No todos yet`, and a simple
   add / check-off / delete list persisted per workspace.

**Done =** clicking the new sidebar/tab-bar button (or shortcut) opens/focuses one tab for the active
workspace; the Checks section reflects the workspace branch's PR live (refreshes); todos persist across
reloads; graceful empty/no-PR/`gh`-missing states; typecheck + targeted e2e green.

## Current state
- `Tab` union (`store/types.ts:146`) has `terminal|file|diff|fileDiff|markdownPreview|conductor|browser|service`.
  Tab content renders in `App.tsx` content area (~`:355-492`); singleton opener pattern is `openDiffTab`
  (`app-store.ts:3603`) — find-existing-by-`(workspaceId,type)` then `addTab`.
- GitHub PR data: `github-service.ts` fetches only the **aggregate** rollup (`statusCheckRollup { state }`)
  into `PrInfo.checkStatus` (`github-types.ts:3,12`). No per-check rows, deployments, or commits-behind.
- `prStatusMap` keyed `"<projectId>:<branch>"` (`app-store.ts:3439`) gives us the PR **number** for the
  workspace branch; polled by `usePrStatusPoller`.
- No existing user-todo model. Per-workspace user data persists trivially via the auto-persisted Zustand
  store (`constellagent-state.json`, 500ms debounce).

## Scope & non-goals
- **In:** Checks-only view + Todos in ONE new tab type; new IPC `github:get-pr-checks`; extended GraphQL;
  Zustand todo model; sidebar/tab-bar open button + shortcut; singleton-per-workspace.
- **Out (locked):** the `All files` / `Changes` sub-tabs (dropped per user); re-implementing any diff
  viewer; editing/triggering checks; cross-repo "commits behind"; todo sync to mobile/agents; DB storage.

## Research conclusion (grounded against the live GitHub GraphQL API via `gh`, this repo, 2026-06-09)
Verified each field by executing real queries against `tridha643/constellagent` PR #300:
- **Per-check rows** — `commit.statusCheckRollup.contexts(first:N){ totalCount nodes { __typename
  ...on CheckRun { name status conclusion startedAt completedAt detailsUrl checkSuite { app { name } } }
  ...on StatusContext { context state description targetUrl createdAt } } }` — query executed with **no
  schema error** (rollup was null only because #300 has no CI).
- **Deployments** — `commit.deployments(last:N){ nodes { environment state latestStatus { state
  environmentUrl logUrl } } }` — **valid**, returned `nodes: []`.
- **Commits behind** — `repository.ref(qualifiedName:"refs/heads/<base>"){ compare(headRef:"<head>"){
  aheadBy behindBy } }` returned `behindBy: 1` for #300 vs `main`. This is the correct source (PR head
  vs base on the **remote**); local `git rev-list HEAD..origin/main` reflects the local checkout (returned
  0 on `main`) and is therefore wrong for this panel.
- No comparable external repo needed indexing — the contract is GitHub's public schema, now pinned to
  what the live API actually accepts.

## Locked decisions
| # | Topic | Decision |
|---|-------|----------|
| 1 | Tab composition | ONE new tab type `checks`; two stacked sections (Checks above, Your todos below). |
| 2 | Sub-tabs | None. Checks view only (no All files / Changes). |
| 3 | Open trigger | Singleton per `(workspaceId,'checks')`, `openChecksTab(workspaceId)` mirroring `openDiffTab`; sidebar button + keyboard shortcut. |
| 4 | Tab payload | `{ type:'checks' }` only — no branch/PR cached in the tab; component derives them live (survives serialization, no stale data). |
| 5 | PR resolution | Component reads the workspace branch → PR number from `prStatusMap` (`<projectId>:<branch>`); if absent, calls `getPrStatuses` once for that branch. No PR ⇒ empty state. |
| 6 | Checks data path | New IPC `github:get-pr-checks` → `GithubService.getPrChecks(repoPath, prNumber)`; new dedicated GraphQL query (does NOT touch the existing `PrFields` fragment / aggregate path). |
| 7 | Commits-behind | From `Ref.compare(headRef).behindBy` inside the same query; same-repo PRs only (cross-repo ⇒ omit the Git-status row). |
| 8 | Deployments source | `commit.deployments` connection (NOT heuristic StatusContext sniffing). |
| 9 | Icon normalization | Map CheckRun.status/conclusion + StatusContext.state → `passing|failing|pending|skipped|neutral` in one shared mapper (main side), so the renderer is dumb. |
| 10 | Duration label | Computed main-side from `startedAt/completedAt` → `6s`/`1m`/`6m` (StatusContext has no duration ⇒ blank). |
| 11 | Todos persistence | Zustand `workspaceTodos: Record<workspaceId, TodoItem[]>`, auto-persisted; cleaned up on workspace delete. **Persistence requires 4 edits (see R5):** add to `PersistedState` type, `getPersistedSlice` return (`:4087`), the `useAppStore.subscribe` equality check (`:4122`), and a validated deserialize in `hydrateState` (`:3690`). Missing any ⇒ todos silently don't persist. |
| 11b | Todo behavior | Fuller widget: add, **inline edit (rename)**, toggle done, delete, **drag reorder**, **clear-completed**. `TodoItem { id, text, done, createdAt }`; ordering = array order (reorder mutates the array). |
| 12 | Refresh | `usePrChecks` runs a **fast 7s poll while the tab is the active tab**, plus immediate fetch on focus/open; stops when inactive. Kept entirely separate from the global `usePrStatusPoller` (no per-workspace bloat). PR-number resolution: read `prStatusMap`; on miss `await github.getPrStatuses(worktreePath,[branch])`, take `.data[branch]?.number`; still null ⇒ "No pull request for this branch". |
| 13 | Failure UX | `gh` missing/unauth/not-github ⇒ inline notice in Checks section; Todos section still fully works. |

## Data contract (new, in `github-types.ts`)
```ts
export type CheckRowStatus = 'passing' | 'failing' | 'pending' | 'skipped' | 'neutral'
export interface PrCheckRow {
  id: string            // stable within a fetch: `${typename}:${name}:${i}`
  name: string          // CheckRun.name | StatusContext.context
  appName?: string      // checkSuite.app.name (GitHub Actions, Vercel, …) | undefined
  status: CheckRowStatus
  durationLabel?: string
  detailsUrl?: string   // CheckRun.detailsUrl | StatusContext.targetUrl
}
export interface PrDeploymentRow {
  id: string
  environment: string   // e.g. dashboard-ipmkekogx-modem-labs
  status: CheckRowStatus
  url?: string          // latestStatus.environmentUrl | logUrl
}
export interface PrChecksDetail {
  number: number; title: string; body: string; url: string; state: PrState
  baseRefName: string; headRefName: string
  total: number; failedCount: number
  checks: PrCheckRow[]; deployments: PrDeploymentRow[]
  commitsBehind: number | null   // null when cross-repo / unknown
}
export interface PrChecksResult {
  available: boolean
  error?: GithubLookupError
  data: PrChecksDetail | null
}
```

## File changes
**New**
- `src/renderer/components/Checks/WorkspaceChecksTab.tsx` — tab shell: Checks section + Todos section.
- `src/renderer/components/Checks/ChecksPanel.tsx` — PR header, git-status, deployments, checks list.
- `src/renderer/components/Checks/TodosPanel.tsx` — add/list/toggle/delete.
- `src/renderer/components/Checks/*.module.css` — styling to match screenshots.
- `src/renderer/hooks/usePrChecks.ts` — resolve branch→PR#→`getPrChecks`, focus+poll, loading/error state.
- `src/main/github-checks.ts` *(or extend `github-service.ts`)* — `getPrChecks`, new query builder, mappers.
- `desktop/e2e/checks-todos-tab.spec.ts` — e2e.
- Unit test(s) beside source for the normalization mappers (`github-checks.test.ts`).

**Modified**
- `src/renderer/store/types.ts` — add `| { type:'checks' }` to `Tab`; add `TodoItem`, `workspaceTodos`,
  todo action signatures, `openChecksTab`.
- `src/renderer/store/app-store.ts` — `workspaceTodos: {}` init; `openChecksTab` (singleton);
  `addTodo/toggleTodo/removeTodo/renameTodo`; drop todos on workspace/project delete; ensure persistence
  whitelist includes `workspaceTodos`.
- `src/renderer/App.tsx` — render branch for `activeTab.type==='checks'` (active-only, like `markdownPreview`).
- `src/renderer/components/TabBar/TabBar.tsx` — label `'Checks'` + icon for `type==='checks'` (~`:80-89`).
- `src/shared/ipc-channels.ts` — `GITHUB_GET_PR_CHECKS: 'github:get-pr-checks'`.
- `src/preload/index.ts` — `github.getPrChecks(repoPath, prNumber)`.
- `src/main/ipc.ts` — register handler → `GithubService.getPrChecks`.
- Sidebar/TabBar — a button that calls `openChecksTab(activeWorkspaceId)`; `useShortcuts.ts` — a shortcut.

## Exhaustive case coverage
**Check status/conclusion → row icon** (mapper):
| Source | Value | Row status |
|--------|-------|-----------|
| CheckRun.status | queued / in_progress / waiting / pending / requested | pending |
| CheckRun.status=completed + conclusion | success | passing |
| ″ | failure / timed_out / startup_failure / action_required | failing |
| ″ | neutral | neutral |
| ″ | skipped / stale | skipped |
| ″ | cancelled | failing (treated as not-passing) |
| ″ | null (completed, no conclusion) | neutral |
| StatusContext.state | SUCCESS | passing |
| ″ | FAILURE / ERROR | failing |
| ″ | PENDING / EXPECTED | pending |
| Deployment latestStatus.state | SUCCESS/ACTIVE | passing; ERROR/FAILURE → failing; else pending |

**Panel-level cases**: rollup null / no contexts ⇒ "No checks"; PR not found / closed-no-PR ⇒ empty
"No pull request for this branch"; `failedCount` = count of `failing`; header text
`{failedCount} / {total} checks failed` (or `All checks passed` when 0); cross-repo PR ⇒ hide git-status
row (commitsBehind null); detached/no branch ⇒ empty; `gh` missing/unauth/not-github ⇒ inline notice.

**Todos cases**: empty ⇒ "No todos yet"; Add with empty/whitespace text ⇒ no-op; toggle persists; inline
edit to empty ⇒ revert (don't delete); delete persists; reorder (drag) persists order; clear-completed
removes only done items; survives reload; per-workspace isolation (keyed by workspaceId, not shared);
workspace delete ⇒ todos removed.

## Test matrix
- **Unit (`bun test`)** — `github-checks.test.ts`: one assertion per mapper row above (CheckRun/StatusContext/
  Deployment → row status); duration label formatting (`s`/`m`); `failedCount`/`total` derivation; cross-repo
  ⇒ `commitsBehind:null`; empty contexts ⇒ `checks:[]`.
- **e2e (`bunx playwright test e2e/checks-todos-tab.spec.ts --project=electron`)** —
  (a) open tab via button → singleton (second open focuses, no dup);
  (b) no-PR branch ⇒ empty Checks notice + Todos usable;
  (c) Todos: add → appears, toggle → checked, inline-edit → renamed, reorder → order persists,
      clear-completed → done items gone, reload (`hydrateState`)/reopen → persists, delete → gone;
  (d) tab label shows "Checks"; close tab works.
- **Manual** — against a real PR with mixed CI (this repo): icons/durations/deploys/behind-count match a
  real PR's `/checks` page; "View checks" opens the PR.

## Verification
```bash
bun test desktop/src/main/github-checks.test.ts
cd desktop && bunx playwright test e2e/checks-todos-tab.spec.ts --project=electron
cd desktop && bun run build 2>&1 | tail -20    # typecheck via electron-vite build
```
(Main-process change ⇒ full ⌘Q + `bun run dev` before manual test, per desktop/CLAUDE.md.)

## Risks / notes
- **R1 — PR-number resolution race**: relying on `prStatusMap` means the tab is empty until the poller
  populates it. Mitigation: hook calls `getPrStatuses([branch])` itself on mount if the map lacks the branch.
- **R2 — contexts pagination**: `contexts(first:100)` caps rows; large matrices truncate. Mitigation: log a
  "+N more" affordance; 100 is well above this repo's 12. No silent infinite paging.
- **R3 — `Ref.compare` cost / cross-repo**: compare adds one nested resolver; cross-repo PRs return null
  base ref ⇒ we already null `commitsBehind` and hide the row. Acceptable.
- **R4 — deployments semantics**: `commit.deployments` returns *all* deployments for the head commit, not
  just the PR's; environments may repeat. Mitigation: dedupe by environment keeping latest; if noisy in
  practice, fall back to top-1 per environment. Surface, don't hide.
- **R5 — persistence whitelist**: confirm the state serializer persists new top-level `workspaceTodos`
  (some stores omit unknown keys). Verify against the persist path before relying on reload survival.
