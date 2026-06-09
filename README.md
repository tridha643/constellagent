# Constellagent

A macOS desktop app for running multiple AI agents in parallel. Each agent gets its own terminal, editor, and git worktree, all in one window. An iOS companion app connects to the desktop over an end-to-end encrypted Tailscale-local bridge.

<img width="3506" height="2200" alt="image" src="https://github.com/user-attachments/assets/9f055656-c213-4d56-8af4-251bd739ad8b" />

## Features at a glance

- **Workspaces** — multi-project manager with an isolated git worktree per workspace; create from new branches, existing branches, PR refs, or open GitHub PRs
- **Terminals** — full terminal emulator (`xterm.js` + `node-pty`) with persistent PTY state, split panes, and agent-aware terminals for Claude, Codex, Gemini, Cursor, OpenCode, and Pi (with last-session resume)
- **Conductor** — a native multi-provider agent chat panel (Codex, Cursor, Pi) with streaming, extended thinking, JSON canvas tool-UIs, image attachments, and a `/side` chat for parallel conversations
- **Editing** — Monaco editing with LSP (TypeScript, Pyright), markdown preview via the prosemark engine (Shiki, Mermaid, file/skill chips), git-aware file tree, and fff-powered Quick Open for files *and* code
- **Git & GitHub** — staging/commit panel with AI commit messages, PR badges (CI, approvals, comments), an open-PR browser with one-click "Pull locally", and Graphite stack support
- **Review** — a full inline review panel (⌘⇧R) with hunk comments, accept/reject staging, an agent-authored code tour, and one-click submission of selected comments to an agent
- **Browser & DOM picker** — embedded webview for localhost dev servers with a React-aware element picker that sends DOM context straight to your agent
- **Linear** — issues/projects/tickets/updates panel with Pi-drafted issue text, fff-ranked pickers, and "open agent on this issue" workflows
- **Plans** — agent-written markdown plans with a searchable palette, build status, and a build launcher across six harnesses
- **Automations** — cron-scheduled and event-driven automations (agent lifecycle, GitHub PR events, Composio webhooks) that spin up worktrees and launch agents headlessly
- **Mobile** — SwiftUI iPhone companion paired over an E2EE Tailscale-local WebSocket bridge
- **Extensibility** — MCP server management, bundled agent skills, Claude/Codex hook configuration, and context history with checkpoint restore

The sections below describe the major panels in depth.

---

## Projects & workspaces

### Adding a project

The **Add Project** dialog (`+` in the sidebar) has two tabs (switch with `⌘⌥←` / `⌘⌥→`):

**Local folder** — pick any directory with the native folder picker. If it isn't a git repository, the app offers to run `git init` for you in place. Repo roots are deduplicated, so adding a worktree resolves back to its parent project.

**Clone from GitHub** — search, browse, and clone without leaving the app:

- **Browse your repos**: with an empty query, the dialog lists your authenticated repos via `gh repo list`
- **Search all of GitHub**: typing a query runs `gh search repos` (debounced) and shows matching public/private repos you can access
- **Paste anything**: full HTTPS URLs, SSH URLs, `github.com/owner/repo`, or plain `owner/repo` shorthand all parse correctly
- Cloning streams progress through validate → prepare → clone → finalize stages, can be cancelled mid-clone (partial directories are cleaned up), and remembers your last clone parent directory
- Friendly errors for auth failures (`gh auth setup-git` hint), missing repos, and non-empty destinations — if the destination is already a clone of the repo, the app offers to add it as a project instead

### Workspaces

Each workspace is an isolated git worktree, so multiple agents can work on the same repo simultaneously without stepping on each other. Workspaces can be created from a new branch, an existing branch, a PR ref, or directly from an open GitHub PR. Per-project startup commands can open and orchestrate multiple terminal tabs automatically when a workspace is created.

---

## Conductor — the agent chat panel

Conductor is the app's native agent chat. Each Conductor tab is one persistent session, stored in a local SQLite database (`conductor-chat.db`) and resumable across app restarts.

**Providers & models** — chat with **Codex** (`@openai/codex-sdk`), **Cursor** (`@cursor/sdk`), or **Pi** (`@mariozechner/pi-coding-agent`). Each provider has its own model catalog and a reasoning-effort selector (minimal/low/medium/high/xhigh, provider-dependent). Auth status and sign-in flows (e.g. Cursor login) are handled in-app.

**Chat capabilities**

- Live streaming responses with a turn-history rail for jumping back through the conversation
- Message queuing: follow-ups are queued in order; "steer" messages redirect a running agent mid-task. Queued messages can be edited or reordered before they're consumed
- Blocking questions: when an agent needs a decision, a question modal appears with options, multi-select, and free-text answers — the run resumes when you answer
- Image attachments via drag, paste, or file picker (PNG/JPEG/GIF/WebP); agent-generated images render inline with a lightbox
- Context-window tracking: a live usage arc in the composer shows tokens used, rate-limit windows, and reset times per provider
- Add-to-chat: send files from the file tree or text selections from the editor into the conversation as context chips

**JSON canvas tool-UIs** — agents can emit structured, interactive UI inline in their replies: cards, callouts, metrics, tables, file-path lists with open-in-editor buttons, progress indicators, and more. Canvases stream incrementally (SpecStream JSONL patches) and render live as the agent builds them, with validation and diagnostics. The bundled `conductor-canvas-*` skills (in `desktop/skills/`) teach agents the catalog.

**Slash commands** — typed in the composer: `/side` (open a side chat seeded with the current thread), `/plan` (plan mode), `/compact` (compact context), `/clear`, `/restart`, `/mcp-status`, `/fast`, plus provider-specific commands (`/add-dir`, `/add-file`, `/personality` for Codex) and any installed skills.

**Side chat panel** — `/side` (or "Open in side chat" actions) opens a second, narrower Conductor chat docked next to the main layout. It forks the current thread's context, inherits the provider/model/thinking settings, and runs independently — useful for side research or follow-ups while the main agent is still working.

**Pi Conductor provider** — run Pi as a Conductor agent with extension UI dialogs and streaming transcripts; `@pi-gui/*` sources are vendored under `desktop/src/lib/pi-gui/`.

---

## Review Changes panel

Press **⌘⇧R** to open the review drawer — a full code-review surface for the working-tree diff.

**Diff viewing** — every changed file renders as side-by-side (split) or inline diffs (toggleable, persisted), with a file strip for quick navigation, per-file "Viewed" checkboxes to collapse files you've finished, and lazy loading for large diffs.

**Inline comments** — hover any line and click `+` to comment (drag to span multiple lines). Comments are stored in `.git/review-annotations.db` (libSQL, via `@tridha643/review-annotations`), so they live with the repo's git directory and are shared across worktrees.

**Human vs. AI comments**

- **Human comments** have checkboxes and can be selected, resolved, or deleted. Only *selected* human comments are included when you submit the review
- **AI-authored comments** (anything with an `author` field — added by agents via IPC or the `hunk` CLI) are display-only context: no checkbox, never submitted
- **GitHub PR comments** are fetched and merged into the same view, also display-only

**Code tour mode** — switches the panel to a guided walkthrough of agent-authored annotations: step-by-step cards with file/line, summary, and rationale, synced to the diff as you navigate. This is how an agent explains its changes to you.

**Accept / reject hunks** — for unstaged changes, each hunk gets Accept (`⌘Y`, stages via `git apply --cached`) and Reject (`⌘N`, reverts via `git apply --reverse`) actions — selective staging without touching the terminal.

**Submit review** — select the comments you want, hit Submit, and the panel formats them into a structured review block and pastes it (bracketed paste) into the active agent terminal, then closes. The agent gets exactly the feedback you selected, file-by-file with line references.

---

## Browser tab & Agentation

Open **Browser** from the sidebar (globe icon) to create a center tab with an embedded webview — primarily for pointing at your localhost dev server (default URL `http://localhost:5173`) while an agent works on the code.

**Agentation toolbar** (◎ control, bottom-right of the loaded page):

1. Click elements to annotate them (tag, CSS path, React component names when available)
2. Add comments per annotation
3. **Copy** writes formatted markdown to your clipboard
4. **Send Annotations** copies markdown and routes it to your agent terminal or Conductor composer

constellagent embeds the Agentation HTTP/SSE server automatically — no `npx agentation-mcp server` required. Annotations sync to the tab's annotation rail via the live event stream.

The **open-PR browser** is a separate feature: right-click a project → "Open Pull Requests" for a filterable list of open PRs (CI status, approvals, comment counts) with one-click **Pull locally** into a new workspace.

---

## Linear panel

A full Linear client lives in the sidebar (Linear icon), authenticated with a personal API key (Settings) and talking to Linear's GraphQL API through the main process.

**Four tabs** (switch with `⌘[` / `⌘]` or `⌘1–4`, reorderable):

1. **Issues** — issues assigned to you or created by you, with state, priority, and team info; drag between workflow states
2. **Projects** — all accessible projects with team context, favoriting, and a pinned "update bar"
3. **Tickets** — create new issues, with **Draft with Pi**: the local Pi CLI generates the title and description from your selected project's metadata *plus a git snapshot of the active workspace* (recent commits, status, diff summaries). Existing draft text is enhanced, not replaced
4. **Updates** — write project status updates, also Pi-draftable, using your last few updates for voice/tone consistency

**fff-powered search** — all pickers and search in the panel are ranked by **fff** (`@ff-labs/fff-node`, the native fuzzy-finder engine from the fff.nvim project), not substring matching:

- Project/workspace pickers build a synthetic index of Linear entities (projects, teams, issues, open workspaces, Graphite stack branches) and rank results with native fuzzy scoring and matched-character highlighting
- **⌘F inside the panel** opens a Linear Quick Open: local results rank instantly via fff, and 2+ character queries also fan out to Linear's GraphQL search (toggleable between "my issues" and the whole workspace), with results merged and re-ranked

**Issue → agent workflow** — "Open agent" on any issue:

- Finds or creates a workspace on a `linear/<issue-id>-...` branch
- Moves the issue to the team's **In Progress** state automatically
- Launches an agent terminal with a **read-only kickoff prompt**: investigate the ticket, inspect the code, propose a plan and risks — and stop before making changes

---

## Search & navigation

- **Quick Open (⌘P / ⌘F)** — fff-backed fuzzy search across the workspace. With "Search code in Quick Open" enabled (Settings), file-name matches and **content grep matches** appear together, labeled `file` / `code`, with file-type icons and highlighted match ranges. Unsaved-buffer changes are flagged since fff reads from disk
- **Spotlight search** — code search and file discovery across projects
- **Keyboard-first UX** — shortcuts for tab/workspace switching, pane management, panel toggles (Files, Changes, Browser, Side Chat), settings, and the plan/context palettes

---

## Automations

Automations run agents without you in the loop. There are two trigger types, both managed in the Automations panel:

### Cron-scheduled

Configured with a cron expression (presets: every 30 min, hourly, every 6 h, daily 9am, weekly Monday). On each tick the automation:

1. Creates a fresh, timestamped worktree on an `auto/<name>/<timestamp>` branch (runs never collide)
2. Launches the chosen agent (Claude Code, Codex, Gemini, Cursor, OpenCode, or Pi) with your prompt
3. Surfaces the run as a normal workspace + terminal tab in the UI

### Event-driven

Triggers fire on:

- **Agent lifecycle** — `agent:started` / `agent:stopped`, detected via activity markers written by the bundled Claude/Codex hooks
- **GitHub PR events** — created, merged, checks failed/passed, approved, changes requested, comments received
- **Workspace events** — created/deleted
- **Composio webhooks** — any external trigger (GitHub, Slack, etc.) routed through Composio

Filters narrow when an automation fires (agent type, branch glob, workspace), and **actions** decide what happens: run a prompt in a new worktree, run a shell command, send a desktop notification, or write text into a live workspace's terminal.

**Safety rails** — per-automation cooldowns (default 30 s), a global rate limit (max 10 automation starts/minute), and PR-merge deduplication (a 2-minute TTL window prevents a webhook and a GitHub poll from double-firing the same merge).

**Composio integration** — the app runs a local webhook server (`127.0.0.1:37581/webhooks/composio`) with optional shared-secret verification, and can spawn an **ngrok tunnel** so Composio can reach it from the internet. Trigger subscriptions are upserted via the Composio API, and incoming payloads are summarized (with secrets redacted) into the agent's prompt. Headless runs include guardrail instructions and auto-approval flags so they complete without permission dialogs.

---

## Plans

Agents write markdown plans into the workspace; the app turns them into a first-class workflow:

- A searchable **plan palette** (with build status and relocation) for every plan in the workspace
- Plan preview rendered with the prosemark engine
- **Build launch**: pick a harness (Claude Code, Codex, Gemini, Cursor, OpenCode, Pi) and a model preset, and the plan is handed to that agent to implement
- Plan metadata is tracked in YAML frontmatter under a `constellagent` namespace

---

## Mobile (iOS companion)

The SwiftUI iPhone app (`ios/Constellagent/`) pairs with the desktop over an end-to-end encrypted WebSocket on your Tailscale network — no public relay.

From the phone you can: list and start sessions, send replies and steering to running agents, browse workspace files, manage git branches/commits/diffs, create and resolve review annotations, and approve or reject plans.

**Setup**

1. Enable the bridge: `CONSTELLAGENT_MOBILE_ACCESS=1` or **Settings → Mobile**
2. Build the iOS app from `ios/Constellagent/Constellagent.xcodeproj`
3. Pair by scanning the QR code in **Settings → Mobile** (trusted devices can be revoked there too)

Shared protocol contracts live in `@constellagent/mobile-protocol` (Zod schemas for RPC methods, events, and E2EE wire frames); Swift adapts them via `ConstellagentService+ProtocolMapping.swift`. Local dev relay overrides go in `ios/Constellagent/BuildSupport/PrivateOverrides.xcconfig` (copy from `.example`; gitignored).

---

## Repository layout

Bun workspaces monorepo (`["packages/*", "desktop"]`).

| Path | What it is |
|------|------------|
| `desktop/` | The Electron macOS app (primary product). Architecture docs: `desktop/CLAUDE.md` |
| `ios/Constellagent/` | SwiftUI iPhone companion app (see `ios/Constellagent/README.md`) |
| `packages/constellagent-mobile-protocol/` | `@constellagent/mobile-protocol` — shared Zod schemas for mobile ↔ desktop RPC, events, and E2EE pairing |
| `packages/review-annotations/` | `@tridha643/review-annotations` — libSQL-backed review annotations + repo memory; ships the `constell-annotate` CLI |
| `desktop/src/lib/pi-gui/` | Vendored `@pi-gui/*` sources for Pi Conductor (`session-driver`, `catalogs`, `pi-sdk-driver`) |
| `packages/pi-constell/` | `pi-constell-plan` — Claude-Code-style plan mode extension for the `pi` CLI |
| `packages/pi-inline-skill-autocomplete/` | Inline skill-name autocomplete extension for the `pi` CLI |
| `landing-page/` | Static marketing site (`bun run landing`) |
| `scripts/` | Repo-root scripts: bundled-skill install, hunk skill install, isolated dev, worktree sync |

Shared agent/coding instructions live in `AGENTS.md` and `CLAUDE.md`; the desktop service map and renderer map live in `desktop/CLAUDE.md`.

---

## Getting started

Requires macOS and [Bun](https://bun.sh).

```bash
bun run setup   # installs deps, rebuilds native modules, and installs bundled agent skills (see AGENTS.md)
bun run dev
```

`dev` and `build` first compile `@constellagent/mobile-protocol`, then start the Electron app.

For isolated development state per git worktree:

```bash
bun run dev-isolated
```

### `constell` CLI

The app installs a `constell` command globally on first launch (symlinks `desktop/bin/constell` → `/usr/local/bin/constell`). Use it to open Constellagent from any terminal:

```bash
constell .          # Open the current directory
constell ~/project  # Open a specific directory
```

In dev mode, `constell` attaches to an already-running Vite dev server (ports 5173–5190) and launches Electron against it. If no dev server is running, it starts one. You can override the renderer URL:

```bash
CONSTELLAGENT_RENDERER_PORT=5174 constell .
CONSTELLAGENT_RENDERER_URL=http://127.0.0.1:5174 constell .
```

### Build and package

```bash
bun run build     # Production build
bun run dist      # Package as signed macOS DMG (arm64)
```

A release workflow (`desktop/workflows/release.yml`) builds and uploads the signed DMG when a `v*` tag is pushed.

---

## Testing

The repo is tested at five layers, from headless unit tests up to full Electron e2e and iOS XCTest.

### 1. Playwright Electron e2e (38 specs)

```bash
bun run test                        # full e2e suite
cd desktop && bunx playwright test e2e/terminal.spec.ts --project=electron   # one spec
cd desktop && bunx playwright test --grep "creates terminal" --project=electron
```

Specs launch the real Electron app against temp git repos and a temp `userData` dir (`CI_TEST=1`), running serially (1 worker) with 30 s timeouts. Coverage spans the whole surface: app layout & state persistence, Conductor chat (composer, slash menu, ask-question, plan approval), terminals & PTYs, file editor & file tree, git sidebar & staging, hunk review & code tour, automations, Linear (5 specs: navigation, issue agent launch, FFF pickers, pills), GitHub PR status & open-PR list, Graphite stacks, plans (per-harness), keyboard shortcuts, panel docking, Claude/Codex hook config, visual/CSS checks, and IPC persistence round-trips.

### 2. Headless smoke tests

```bash
bun run test:automations      # automations engine smoke (no Electron window)
bun run verify:automations    # build + smoke + manual checklist (docs/automations-verification.md)
```

The smoke harness exercises the automation engine in isolation with a fake PTY manager and stubbed shell/notification calls: event-driven triggers, cooldown suppression, notification delivery, and write-to-pty actions.

### 3. Desktop unit tests (~119 files)

```bash
cd desktop && bun test src/main/composio-payload.test.ts    # any single file
```

`*.test.ts` files are colocated with their sources across `src/main/` (~49: agent drivers, git operations, mobile bridge, automations, storage), `src/shared/` (~37: JSON canvas, plan metadata, protocol types), and `src/renderer/` (~33: components and utilities).

### 4. Workspace package tests

```bash
bun test packages/constellagent-mobile-protocol/src/index.test.ts
bun test packages/review-annotations/src/index.test.ts
cd packages/pi-constell && bun test    # incl. an extension e2e test
```

### 5. iOS tests (XCTest)

```bash
cd ios/Constellagent && xcodebuild test -scheme Constellagent -destination 'platform=iOS Simulator,name=iPhone 15'
```

Five Swift suites cover connection-error recovery and keep-alive behavior, streaming delta merging, timeline reduction, secure-pairing state, and QR pairing validation.

### Focused suites

```bash
bun run test:automations:e2e            # automations Electron e2e
bun run test:review:e2e                 # hunk review e2e (from desktop/)
cd desktop && bun run test:composio-unit     # Composio payload unit tests
cd desktop && bun run verify:files-panel     # file-tree e2e slice
```
