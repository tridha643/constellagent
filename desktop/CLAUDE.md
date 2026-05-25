# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in the **`desktop/`** Electron app.

Repo-wide agent instructions (storage model, Cachebro, **review annotations**, **author tagging**, **Sendblue CLI notifications**, mobile bridge, packages) live in **`../AGENTS.md`**. Use **`constell-annotate add --file <path> --new-line <N> --summary "..." --author "claude-code"`** to add review annotations. Install: `npm i -g @tridha643/review-annotations`. **Always pass `--author "claude-code"`** when adding comments.

## Mandatory Sendblue notifications

Claude Code work in this repo is not complete until these Sendblue CLI notifications have been attempted:

```bash
sendblue send +<YOUR_E164_RECIPIENT> "claude-code <plan-topic-name> plan created"
sendblue send +<YOUR_E164_RECIPIENT> "claude-code <plan-topic-name> is over"
```

- Retry each command up to 3 times if it fails.
- If all retries fail, the final response must say that explicitly with the failure text.
- The `task over` notification happens after required tests/builds and review annotations, before reporting completion.

## Commands

Run from the **repo root** (these wrap the `desktop` scripts and first build the workspace packages — `constellagent-mobile-protocol` + `pi-gui-*`):

```bash
bun run setup        # Install deps, rebuild native modules, install bundled agent skills
bun run dev          # Build packages + start electron-vite dev server + Electron app
bun run build        # Production build to desktop/out/
bun run dist         # Build + package signed macOS DMG (electron-builder --mac --arm64)
bun run test         # Playwright e2e (delegates to desktop `bunx playwright test --project=electron`)
bun run rebuild      # Rebuild native modules (node-pty) for Electron (bunx electron-rebuild)
bun run dev-isolated # Isolated dev profile per git checkout (sh scripts/dev-isolated.sh)
```

Run from **`desktop/`** for finer-grained targets (see `desktop/package.json`):

```bash
bunx playwright test e2e/tabs.spec.ts --project=electron          # Single test file
bunx playwright test --grep "creates terminal" --project=electron # Single test by name
bun run test:automations      # Headless automations smoke (scripts/automations-smoke.ts)
bun run test:automations:e2e  # Focused automations Electron e2e (e2e/automations.spec.ts)
bun run test:review:e2e       # Review/hunk e2e (e2e/hunk-review.spec.ts)
bun run test:composio-unit    # bun test src/main/composio-payload.test.ts
bun run verify:automations    # Build + smoke + manual checklist (scripts/verify-automations.sh)
bun run verify:files-panel    # File-tree e2e slice (e2e/file-editor.spec.ts -g "file tree")
```

`bun run build` runs `scripts/electron-vite-build.mjs`; `bun run dist` then packages with `electron-builder --mac --arm64`. `postinstall` runs `scripts/postinstall.mjs` (also patches Electron dev + `@pierre/diffs` via `scripts/patch-*`).

Unit tests (`*.test.ts`) live next to their source under `src/main/` and `src/shared/` and run with **`bun test <file>`**.

**Multiple git worktrees / parallel dev:** Normal `bun run dev` uses the standard `userData` path (projects persist in `constellagent-state.json`). For **isolated** dev (separate profile per checkout), from repo root run **`bun run dev-isolated`** (`sh scripts/dev-isolated.sh`). Universal fallback (any branch): **`CONSTELLAGENT_ISOLATED_DEV=1 bun run --cwd desktop dev`**. Isolated profiles live under `…/Constellagent/dev-worktree/<hash>/`. Vite uses `strictPort: false` (port 5173, then next free); override with `CONSTELLAGENT_VITE_PORT` / `CONSTELL_PORT`. The `constell` helper sets `ELECTRON_RENDERER_URL` when attaching (scans 5173–5190); override with `CONSTELLAGENT_RENDERER_PORT` / `CONSTELLAGENT_RENDERER_URL`.

After modifying native dependencies: `bun run rebuild`

**Main vs renderer in dev:** Changes under `src/main/` or `src/shared/ipc-channels.ts` require a **full app quit (⌘Q)** and a fresh `bun run dev`. **⌘R / Reload** only reloads the renderer; if you see `No handler registered for 'fs:…'`, the running main process is stale.

## Architecture

Electron app with three processes communicating via IPC. The **`@shared`** alias resolves to `src/shared/` in all three processes; **`@`** resolves to `src/renderer/` in the renderer only (`electron.vite.config.ts`).

```
Main Process (Node.js, src/main/)     Preload (src/preload/index.ts)   Renderer (React, src/renderer/)
├── index.ts (entry, window, CLI)     contextBridge → window.api       ├── App.tsx (Allotment layout)
├── ipc.ts (handler registry)         namespaces: git, pty, fs, app,   ├── store/app-store.ts (Zustand)
├── <domain>-service.ts × ~40           state, github, graphite,       ├── components/ (30 dirs)
├── agents/ (codex/cursor/pi drivers)   mobile, automations, composio, ├── hooks/ (~16 pollers/shortcuts)
└── mobile-*.ts (iOS bridge)            agentChat, pi, lsp, mcp, …     └── pi-gui/ (Conductor agent GUI)
```

**IPC pattern**: Renderer calls `window.api.*` → preload runs `ipcRenderer.invoke()` / `.send()` with a channel constant from **`src/shared/ipc-channels.ts`** → main handlers in **`ipc.ts`** delegate to service classes. PTY data streams back via `ipc:data:{ptyId}` events. `ipc.ts` is the handler registry (`registerIpcHandlers()` called from `index.ts`); it instantiates the service singletons.

### Main-process service map (`src/main/`, ~142 `.ts` files incl. subdirs/tests; ~99 source)

Use this to jump straight to the owning file for a feature. Subdirs: `agents/` (provider drivers + bridges), `automations/` (runner + delivery routing), `lsp/` (language-server lifecycle).

| Domain | Key files | Responsibility |
|--------|-----------|----------------|
| **App lifecycle** | `index.ts`, `app-relaunch.ts`, `notification-watcher.ts`, `persisted-state.ts`, `perf.ts` | Window creation, `constell` CLI symlink, relaunch, macOS notification listener |
| **IPC** | `ipc.ts` | Central `ipcMain.handle`/`.on` registry; wires every service |
| **Git / worktrees** | `git-service.ts`, `git-snapshot.ts`, `worktree-sync-service.ts`, `worktree-credential-copy.ts`, `commit-message-service.ts` | Worktree CRUD, staging/commit/diff/log, sync across worktrees, AI commit-message generation |
| **Terminal** | `pty-manager.ts` | node-pty processes, OSC titles, scrollback ring buffers, exit callbacks |
| **Files / search** | `file-service.ts`, `spotlight-service.ts`, `package-scripts-service.ts` | File tree, read/write, quick-open, code search, plan-markdown discovery |
| **Storage** | `agentfs-service.ts`, `plan-meta.ts`, `annotation-service.ts`, `agent-chat-store.ts` | AgentFS/libSQL access, plan frontmatter, review annotations, chat transcripts |
| **Agent chat / Conductor** | `agent-chat-host.ts`, `agent-chat-queue.ts`, `conductor-auth.ts`, `conductor-settings.ts`, `conductor-image-picker.ts` | Orchestrates agent sessions, queues, API-key/auth caching |
| **Agent drivers** | `agents/agent-driver.ts`, `agents/codex-driver*.ts`, `agents/cursor-driver*.ts` + `cursor-sdk-interaction-patch.ts` / `cursor-subagent-config.ts`, `agents/pi-conductor-driver.ts`, `agents/conductor-question-bridge.ts`, `agents/json-canvas-bridge.ts`; root `cursor-sdk-*.ts` | Per-provider CLI/SDK integration (Codex, Cursor, Pi); ask-question + JSON-canvas bridges |
| **GitHub / Graphite** | `github-service.ts`, `github-poll-service.ts`, `graphite-service.ts` | PR status via `gh` GraphQL (90s poll), Graphite stacks |
| **Automations** | `automation-scheduler.ts`, `automation-engine.ts`, `automation-event-bus.ts`, `automation-merge-dedupe.ts`, `automations/*.ts` (`automation-runner.ts`, `delivery-router.ts`, `composio-definition-store.ts`) | Cron + event-driven workspace/agent automations; delivery routing |
| **Composio** | `composio-webhook-service.ts`, `composio-webhook-subscriptions.ts`, `composio-trigger-client.ts`, `composio-ngrok-service.ts`, `composio-payload.ts`, `composio-pi-draft.ts`, `composio-repo-resolve.ts` | Webhook/trigger ingestion for event automations |
| **Mobile bridge** | `mobile-service.ts`, `mobile-local-server.ts`, `mobile-method-router.ts`, `mobile-event-bridge.ts`, `mobile-secure-transport.ts`, `mobile-store.ts`, `mobile-git-bridge.ts`, other `mobile-*.ts` | iOS companion: local WS server, E2EE, RPC routing, pairing, device tools |
| **Pi host** | `pi-host-service.ts`, `pi-run-prompt.ts`, `pi-session-state.ts`, `pi-timeline.ts` | Constellagent as a local Pi SDK host |
| **Skills / MCP / LSP** | `skills-service.ts`, `mcp-config.ts`, `mcp-status-service.ts`, `lsp/lsp-service.ts` + `lsp/lsp-server-manager.ts` + `lsp/lsp-config.ts` | Skill/subagent KV catalog, MCP server config (`~/.claude.json`), language servers (TS + Pyright over WS-JSONRPC) |
| **CLI config** | `claude-config.ts`, `codex-config.ts`, `cursor-model-catalog.ts`, `project-startup-settings.ts`, `cli-env.ts`, `load-env-local.ts` | Read/write external CLI config, `$PATH` extension, per-project startup commands |
| **Usage** | `codex-usage-service.ts`, `cursor-usage-service.ts`, `context-window-service.ts` | Rate-limit / token-usage tracking |
| **Linear** | `linear-draft-service.ts`, `linear-fff-service.ts` | Linear issue draft generation; FFF (`@ff-labs/fff-node`) project/workspace pickers |

### Renderer map (`src/renderer/`)

| Area | Path | Notes |
|------|------|-------|
| Root layout | `App.tsx` | Allotment split-pane shell; `index.tsx` is the React entry |
| State | `store/app-store.ts` (~3.7k lines), `store/types.ts`, `store/side-panels.ts`, `store/split-helpers.ts` | Single Zustand store (see **State Management** below) |
| Components | `components/` (30 subdirs) | `Terminal`, `Editor`, `Sidebar`, `TabBar`, `RightPanel`, `Conductor`, `PiThread`, `QuickOpen`, `Spotlight`, `BrowserPanel`, `Markdown`/`MarkdownPreview`/`MarkdownRenderer`, `HunkReview`, `Automations`, `PlanPalette`, `PlanAgentToolbar`, `Settings`, `AddToChat`/`AddToChatButton`, `FloatingPanel`, `SidePanelHost`, `Toast`, `Tooltip`, `Icons`, `Service`, `tool-ui/`, `ui/` (shadcn/base-ui) … |
| Markdown engine | `lib/prosemark/` | **Primary** markdown renderer — CodeMirror 6 ("prosemark"): `MarkdownStream.tsx` + extensions for headings/tables/code-fences (Shiki), mermaid, file/skill chips, link unfurls, fold/hide. `MarkdownRenderer` wraps it via `useMarkdownSurfaceContext`. (Streamdown is now only the pi-gui chat fallback + global CSS.) |
| Hooks | `hooks/` (16) | `useShortcuts`, `usePrStatusPoller`, `useWorktreeSyncPoller`, `useContextWindowPoller`, `useUsageLimitsPoller`, `useGraphiteStackPoller`, `useConductorContextUsage`, `useFileWatcher`, `useGitGutter`, `useFocusTrap`, `useExitAnimation`, `useMarkdownSurfaceContext`, `useLinearProjectPickerFff`, `useLinearWorkspacePickerFff`, `use-prefers-reduced-motion`, `use-proximity-hover` |
| Conductor GUI | `pi-gui/` | Pi/Conductor agent chat UI + hooks (Streamdown via `message-markdown.tsx`) |
| Other dirs | `agents/`, `services/` (`lsp-client-manager.ts`), `lib/`, `utils/` (bridges: `add-to-chat-monaco-bridge.ts`, `changes-file-find-bridge.ts`, …), `types/`, `linear/` (`LinearWorkspace`), `assets/` | Renderer-side helpers, LSP client, Monaco/Changes bridges, Linear UI |
| Styles / theme | `styles/global.css`, `theme/`, `themes/` | Tailwind v4, Streamdown/KaTeX/Shiki CSS |

### Shared code (`src/shared/`, source of truth across processes)

- **`ipc-channels.ts`** — all IPC channel-name constants (the main↔renderer contract).
- **Plan handling** — `agent-plan-path.ts` (`AGENT_PLAN_RELATIVE_DIRS`, `isAgentPlanPath`), `plan-build-command.ts` (`BUILD_HARNESS_OPTIONS`, `PLAN_MODEL_PRESETS`), `plan-meta.ts` helpers consumed via plan-meta in main.
- **Types** — `agent-chat-types.ts` (`AgentProvider = 'codex'|'cursor'|'pi'`), `diff-annotation-types.ts`, `git-types.ts`, `github-types.ts`, `graphite-types.ts`, `automation-types.ts`, `composio-types.ts`, `mobile-settings-types.ts`, `context-window-types.ts`, plus `pi/` subdir.
- **Markdown / canvas** — `json-canvas-schema.ts`, `normalize-markdown-*.ts`, `plan-markdown-preview.ts`.
- **Composer** — `composer-at-mention.ts`, `composer-hash-mention.ts`, `conductor-composer-commands.ts` (slash commands).
- **Agent markers** — `agent-markers.ts` (terminal activity detection per agent: claude-code, codex, cursor, gemini, opencode, pi-constell).

Import shared modules from main/renderer via **relative** paths (`../shared/...`) where electron-vite's main bundle needs reliable resolution (e.g. `agent-plan-path.ts`).

## Storage (AgentFS + Turso libSQL)

Constellagent no longer writes workspace context-capture files or creates a `.constellagent/` directory **for context/session history**. Embedded Turso/libSQL files live under the repo's `.git/` directory (so they don't pollute the working tree and travel with the repo's git dir). **Exception:** the mobile bridge creates `.constellagent/worktrees/<token>/` at runtime when a paired phone runs git operations (`mobile-git-bridge.ts`; detected by `mobile-workspace-registry.ts`).

### Databases

| DB file | Location | Created by | Purpose |
|---------|----------|------------|---------|
| `<sessionId>.db` (default `constellagent.db`) | repo `.git/` | `agentfs-service.ts` | AgentFS-backed app/session data + KV |
| `review-annotations.db` | git **common dir** | `annotation-service.ts` | Inline review annotations on diffs |
| `conductor-chat.db` | app `userData` | `agent-chat-store.ts` | Agent chat session metadata + transcripts |
| `mobile-access.db` | app `userData` | `mobile-store.ts` | Trusted devices + bridge identity |
| `.graphite_metadata.db` | repo `.git/` | Graphite CLI (not us) | Graphite stack metadata (read via `graphite-service.ts`) |

There is **no `better-sqlite3`** — all SQLite access goes through `agentfs-sdk` / `@libsql/client`.

### AgentFS access pattern (main process)

1. **`getAgentFS(projectDir, sessionId?)`** (`agentfs-service.ts`) — lazily `AgentFS.open({ id, path })`, dedupes concurrent inits, caches instances in a `Map`, stores DB files in `.git/`, and runs a periodic **`PRAGMA wal_checkpoint(TRUNCATE)`** timer so the WAL doesn't grow unbounded.
2. **`agent.getDatabase()`** — async libSQL API (`prepare` / `run` / `all` / `exec`).
3. **`agent.kv`** — key-value namespace inside the same DB file for mirrored skill/subagent metadata.

**`SkillsService`** — KV catalogs enabled skills/subagents (`skill:{name}`, `subagent:{name}`). Bundled Conductor canvas skills live in `desktop/skills/` and install via root `scripts/install-bundled-skills.sh` (run by `bun run setup`) into gitignored agent dirs — see root `AGENTS.md`.

**Review annotations** — stored in the git common dir's `review-annotations.db` via `annotation-service.ts` and `constell-annotate`.

### AgentFS virtual-filesystem note (Turso model vs this repo)

When AgentFS is installed in an **isolated agent environment**, the DB can be surfaced as a **POSIX-style tree of virtual files**, where `grep`/`rg`/globbing over the mounted tree are valid. **Constellagent does not do this** — it uses `agentfs-sdk` in the **main process only** and exposes no FUSE/virtual mount. Treat the `.git/` DBs as internal app storage; use explicit libSQL access (or `constell-annotate` for annotations) to inspect them.

**Cachebro** — `cachebro` is a `desktop/` dependency (CLI MCP server: `cachebro serve`) providing `read_file`, `read_files`, `cache_status`, `cache_clear` tools that return diffs instead of full re-reads. It is **not** configured by a committed file in this repo; configure it once per machine with `npx cachebro init` (writes your global `~/.claude.json` / Cursor MCP config). Prefer the cachebro MCP tools over raw reads when available.

**GitHub PR integration**: `github-service.ts` uses the `gh` CLI (same `execFileAsync` pattern as `GitService`) to fetch PR status per branch. Polls every 90s via `usePrStatusPoller`. Ephemeral state in Zustand (`prStatusMap`, `ghAvailability`) — not persisted. Degrades silently when `gh` is missing, unauthenticated, or the repo isn't on GitHub.

## State Management

Single Zustand store (`app-store.ts`) with this shape:
- `projects` → `workspaces` → `tabs` (hierarchical ownership)
- Tab types: `terminal` (has ptyId), `file` (has filePath), `diff`, `markdownPreview` (rendered `.md` / `.mdx` via the prosemark CodeMirror renderer — `MarkdownRenderer` → `lib/prosemark/MarkdownStream`)
- **Markdown plans**: Clicking `.md`/`.mdx` in the file tree or quick-open opens a **preview tab** (live reload on disk changes). Right-click → **Open in editor** for Monaco; preview tab toolbar has **Edit**. Cmd/Ctrl+click still opens **split** with the file editor. **Rendering engine:** markdown surfaces render through **`MarkdownRenderer`** → **`lib/prosemark/MarkdownStream`**, a **CodeMirror 6**–based renderer ("prosemark") with extensions for headings, tables, code fences (Shiki syntax highlighting), mermaid, file/skill chips, link unfurls, and fold/hide. The pi-gui Conductor chat (`pi-gui/message-markdown.tsx`) still uses **Streamdown** as a fallback variant for plain (non-chip) streamed messages. Styling: `global.css` imports `streamdown/styles.css`, `katex/dist/katex.min.css`, **`@import "tailwindcss"` without a class prefix** (v4 `prefix(tw)` breaks Streamdown), `@theme inline` for shadcn semantic colors, **`@custom-variant dark (&:where(.dark, .dark *))`** plus **`class="dark"` on `<html>`** so Shiki's `dark:*` token utilities apply even when the OS theme is light; **`@source inline(…)`** safelists Streamdown/Shiki arbitrary utilities (minified `node_modules` bundles are not reliably scanned). `MarkdownRenderer.module.css` + `lib/prosemark/prosemark-chat-theme.css` add layout/color fallbacks for code blocks, tables, and Mermaid toolbars.
- **Latest plan**: Sidebar **Plans** button opens the newest `.md`/`.mdx` (by mtime) under `.cursor/plans`, `.claude/plans`, `.codex/plans`, `.gemini/plans`, or `.opencode/plans` in the active workspace (`FileService.findNewestPlanMarkdown`, IPC `FS_FIND_NEWEST_PLAN`). **⇧⌘M** opens a **plan palette** (`PlanPalette`) with prefix-based search and per-agent filter chips (`FileService.listAgentPlanMarkdowns`, IPC `FS_LIST_AGENT_PLANS`). The palette shows **Built/Not built** pills and optional **codingAgent** label per entry.
- **Plan metadata**: Plans use a `constellagent`-namespaced block inside YAML frontmatter (`constellagent.built`, `constellagent.codingAgent`). Parsed via `plan-meta.ts` (`readPlanMetaPrefix` reads only a 16 KiB prefix for list performance; `writePlanMeta` deep-merges the namespace). IPC: `FS_READ_PLAN_META` (read-only), `FS_UPDATE_PLAN_META` (patch frontmatter), `FS_RELOCATE_AGENT_PLAN` (copy/move between agent plan dirs with collision handling). **MarkdownPreview** toolbar (plan files only) exposes a model dropdown, Build button, and relocate menu. Shared plan-path helpers live in `src/shared/agent-plan-path.ts` (imported from main/renderer via **relative** paths like `../shared/...` so electron-vite's main bundle resolves them reliably).
- **Plan Build**: The plan preview toolbar has a **harness** selector (Claude / Codex / Gemini / Cursor / OpenCode, or "Match folder") stored as `constellagent.buildHarness` (null = use the plan file's directory). The **model** dropdown follows the selected harness (`PLAN_MODEL_PRESETS` in `src/shared/plan-build-command.ts`). **Build** moves the plan into the target harness folder if it is elsewhere (`FS_RELOCATE_AGENT_PLAN` with `move`), retargets the preview tab, then spawns a terminal with the matching CLI (`claude`, `codex`, `gemini`, `cursor-agent`, or `opencode`) and `--model` when applicable. A spinner runs until `onNotifyWorkspace` fires, then `constellagent.built` is set true. Limitation: notify is workspace-level, not plan-correlated; 5-minute spinner timeout as a safety net.
- UI state: activeWorkspaceId, activeTabId, panel visibility, settings
- Auto-persists to disk via debounced IPC (500ms) to `~/.userData/constellagent-state.json`
- Exposed as `window.__store` in dev for e2e testing

## Key Patterns

**Terminal lifecycle**: xterm terminals are rendered with `visibility:hidden` when inactive (not unmounted) to preserve scrollback and TUI state. PTY processes live in main process via node-pty.

**Capture-phase keyboard shortcuts**: terminal input can consume keydown events before global handlers run. All global shortcuts in `useShortcuts.ts` must use capture phase (`addEventListener('keydown', handler, true)`) and call `stopPropagation()` on consumed shortcuts.

**⌘F / Ctrl+F**: when the Monaco file editor has focus (`add-to-chat-monaco-bridge.ts`), the shortcut runs Monaco's find widget; on an active **diff** tab or with focus in the right-panel **Changes** list, it opens fuzzy find over those changed paths (`changes-file-find-bridge.ts`); otherwise it toggles Quick Open.

**Shift+Enter workaround**: the shortcuts hook intercepts Shift+Enter and writes `\x1b[13;2u` (kitty keyboard protocol) directly to PTY so CLIs like Claude Code can distinguish new-line from submit.

**Monaco in Allotment**: Pane children need `height: 100%` (not flex) and `position: absolute; inset: 0` within a `position: relative` parent to size correctly.

## Testing

E2e tests use Playwright's `_electron` adapter (`--project=electron`), live in `desktop/e2e/`. Key conventions:
- `CI_TEST=1` env var suppresses `mainWindow.show()` and redirects `userData` to a temp directory (tests never touch real app state)
- Tests reset store state at start: `store.hydrateState({ projects: [], workspaces: [] })`
- Tests create temp git repos in `/tmp`, use `realpathSync()` for macOS symlink resolution
- `contextBridge` freezes `window.api` — can't spy on methods, test behavior indirectly
- CSS modules mangle class names — use `[class*="specificName"]` selectors
- Tests run serially (`workers: 1`) due to window focus dependencies
- Unit tests (`*.test.ts` beside source in `src/main/` and `src/shared/`) run with `bun test <file>`

## OpenSpec change workflow (`desktop/openspec/`)

The desktop app uses **OpenSpec** (`schema: spec-driven`, `openspec/config.yaml`) for structured, spec-first changes. Active change folders live under `openspec/changes/<name>/` (e.g. `add-automations`, `improve-changes-tab-staging`, `unread-indicator`).

Agent-facing entry points are committed under `desktop/.claude/`:

- **Skills** (`.claude/skills/openspec-*`): `new-change`, `continue-change`, `ff-change`, `apply-change`, `verify-change`, `sync-specs`, `archive-change`, `bulk-archive-change`, `explore`, `onboard`.
- **Slash commands** (`.claude/commands/opsx/*.md`): `/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:apply`, `/opsx:verify`, `/opsx:sync`, `/opsx:archive`, `/opsx:bulk-archive`, `/opsx:explore`, `/opsx:onboard`.

Use these when adding or modifying a desktop feature spec-first: create a change, fill artifacts, implement, verify, then archive.

## Local agent harness config (committed)

- `.claude/` — OpenSpec skills + `/opsx` commands (above)
- `.codex/plans/` — Codex plan output (`README.md` explains the convention)
- `.pi/tasks/` — Pi task state (`tasks-<uuid>.json`)
- `.tool-ui/agent.json` — tool-UI plugin binding for the active agent
- `claude-hooks/` (`session-save.sh`, `activity.sh`, `notify.sh`) and `codex-hooks/` (`notify.sh`) — notification/context hooks
- `workflows/release.yml` — release workflow; `docs/automations-verification.md` — automations manual checklist; `PUBLISHING.md` — publish steps

## Mandatory AI annotations on code changes

After a successful build and before reporting work done, annotate **every source file you modified** with at least one `constell-annotate add … --author "claude-code"` comment explaining **why** (not what). Skip auto-generated files (`bun.lock`). See `../AGENTS.md` for the full workflow and validation rules.
