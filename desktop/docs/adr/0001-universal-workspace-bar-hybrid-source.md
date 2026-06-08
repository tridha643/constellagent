# 0001 — Universal workspace bar with a hybrid (local-git ⇄ PR-API) data source

- Status: Accepted
- Date: 2026-06-08
- Area: Desktop sidebar (`src/renderer/components/Sidebar`)

## Context

The sidebar redesign (rudu `RepoSidebarItem` port) renders each workspace as a
rectangular "bar" showing an identity, a one-line summary, and `+N -N` diff
stats. Two data sources can populate that bar:

- **Local git** — branch name, latest commit subject, and a working-tree-inclusive
  numstat against `merge-base(origin/HEAD, HEAD)`. Always available, accurate to
  disk, but local-only (no author identity beyond the branch, no review state).
- **GitHub PR API** — the PR author (+avatar), PR title, and the PR's own
  additions/deletions, plus CI rollup. Richer and review-oriented, but only
  exists once a PR is open, lags the working tree, and depends on `gh`
  availability/network.

We had to decide whether the bar is one layout fed by whichever source applies,
or two distinct row designs.

## Decision

A **single universal bar layout** whose **content source flips by PR existence**:

- **PR mode** (`prStatusMap[project:branch].state === 'open'`): author + avatar ·
  PR title · the PR's real `+N -N` · CI chip.
- **Local mode** (no open PR): name≡branch · latest commit subject ·
  working-tree-inclusive local `+N -N`.

The layout is identical in both modes. Both faces are rendered into one CSS grid
cell; the inactive one is hidden with `opacity:0; filter:blur(3px)`. Because the
geometry never changes, the local⇄PR transition is a pure opacity+blur crossfade
with **no reflow**.

Local stats refresh on the existing ~90s PR-poll cadence
(`useWorkspaceBarStatsPoller`), and local additions/deletions are computed as
`git diff --numstat <merge-base>` **without** `..HEAD`, so uncommitted edits to
tracked files are included.

## Consequences

- **Staleness ↔ live-accuracy (accepted):** working-tree-inclusive stats on a 90s
  cadence mean edits surface at the next poll, not instantly. The `headSha` on
  `WorkspaceBarStats` lets the poller cheaply detect unchanged HEADs.
- **No manual mode toggle:** the demo mockup's per-row `⇄` flip and slow-mo are
  intentionally **not** ported — production mode is always derived from PR
  existence, so a manual override would be a lie about the data.
- **Graceful degradation:** non-GitHub remotes / offline / `gh` unavailable stay
  in local mode forever, which is fully functional. The owner avatar
  (`github.com/{owner}.png`) is an unauthenticated image fetch with an `onError`
  fallback to a generic glyph.
- **Hard to reverse:** once render, pollers, store maps, and the GraphQL fields
  (`author{login}`, `additions`, `deletions`) are built around the hybrid model,
  splitting back into two row designs would touch every layer. This is why it is
  recorded here.

## Alternatives considered

- **Two separate row designs (local vs PR):** rejected — doubles the render/CSS
  surface and makes the open-a-PR transition a jarring layout swap instead of a
  crossfade.
- **PR-only stats (drop local numstat):** rejected — leaves pre-PR workspaces with
  no summary and no diff signal, which is most of a workspace's life.
- **Live (file-watcher) local stats instead of poll:** deferred — more accurate
  but materially more expensive per workspace; the 90s cadence + `headSha` skip
  is the cheaper trade-off for a high-frequency-but-glanceable surface.
