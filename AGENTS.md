# Constellagent App — Universal Agent Instructions

These instructions apply to **any repository** where the constellagent app is in use — not just the constellagent codebase itself. They govern **all** coding agent harnesses (Cursor, Claude Code, Codex, Gemini, OpenCode, etc.).

> **Fast navigation:** This file covers cross-repo policy (annotations, Sendblue, mobile, skills) and the monorepo's top-level map. For a file-by-file **service map** of the desktop app (which `*-service.ts` owns which feature), the **markdown engine (prosemark/CodeMirror)**, the **JSON canvas / tool-UI rendering** subsystem (`@json-render/*`), and the **OpenSpec change workflow** (`/opsx:*`), see **`desktop/CLAUDE.md`** → *Main-process service map* / *Renderer map* / *JSON canvas* / *OpenSpec change workflow*. Cursor users: repo rules live in `.cursor/rules/constellagent.mdc`.

## Constellagent monorepo layout (this repository)

Bun workspaces: root `package.json` declares `["packages/*", "desktop"]`.

| Path | Role |
|------|------|
| `desktop/` | Electron macOS app — the primary product (`bun run dev` from repo root). Deep architecture: `desktop/CLAUDE.md` |
| `ios/Constellagent/` | SwiftUI iPhone companion app (Xcode; see `ios/Constellagent/README.md`) |
| `packages/constellagent-mobile-protocol/` | `@constellagent/mobile-protocol` — shared **Zod** schemas / RPC + event types for mobile ↔ desktop |
| `packages/review-annotations/` | `@tridha643/review-annotations` — review-annotation + memory library; ships the **`constell-annotate`** CLI |
| `packages/pi-gui-session-driver/` | `@pi-gui/session-driver` — durable session-driver contract (base, no deps) |
| `packages/pi-gui-catalogs/` | `@pi-gui/catalogs` — catalog data structures for pi-gui sessions |
| `packages/pi-gui-pi-sdk-driver/` | `@pi-gui/pi-sdk-driver` — thin SDK session driver over the pi runtime (has its own `AGENTS.md`) |
| `packages/pi-constell/` | `pi-constell-plan` — Claude-Code-style plan mode for the `pi` CLI |
| `packages/pi-inline-skill-autocomplete/` | inline skill autocomplete extension for `pi` |
| `landing-page/` | static marketing site (vanilla HTML/CSS/JS; `bunx serve landing-page`) |
| `scripts/` | repo-root shell scripts (skill install, isolated dev, worktree sync) |

**Root scripts** (`package.json`): `bun run setup`, `bun run dev`, `bun run build`, `bun run test`, `bun run dev-isolated`, `bun run dist`, `bun run rebuild`. `dev`/`build` first build `constellagent-mobile-protocol` and the `pi-gui-*` packages; the mobile-protocol + pi-gui packages also build automatically on `bun install` (`postinstall`).

**Root scripts directory** (`scripts/`):

| Script | Purpose |
|--------|---------|
| `install-bundled-skills.sh` | Symlink `desktop/skills/conductor-canvas-*` into gitignored `.codex/skills/`, `.cursor/skills/` |
| `install-hunk-skill.sh` | Fetch the upstream `modem-dev/hunk` review skill (`HUNK_SKILL_REF` to pin) and symlink for Claude/Cursor/Gemini |
| `dev-isolated.sh` | Per-checkout isolated Electron profile (`CONSTELLAGENT_ISOLATED_DEV=1`) |
| `sync-worktrees.sh <repo>` | Stash → rebase onto origin default → pop, across all worktrees |

## Mobile access (iOS companion)

The iPhone app pairs with the desktop app over **Tailscale** (local bridge; no public WS relay in the current plan). The desktop side lives under `desktop/src/main/mobile-*.ts`; the SwiftUI client under `ios/Constellagent/`.

### Architecture

```
iPhone (SwiftUI)                    macOS (Electron main)
ConstellagentService  ←— E2EE WS —→  mobile-local-server.ts
       │                                      │
       │ ProtocolMapping.swift                ├─ mobile-method-router.ts → git / workspace / session / annotation services
       │ (codex RPC ↔ bridge vocabulary)      └─ mobile-event-bridge.ts → streaming session events
       │
packages/constellagent-mobile-protocol  ← shared Zod contracts (TypeScript source of truth)
```

**Key files**

- `packages/constellagent-mobile-protocol/src/index.ts` — RPC methods, events, pairing payloads, secure-transport constants
- `desktop/src/main/mobile-local-server.ts` — HTTP status + WebSocket upgrade, pairing codes, command queue
- `desktop/src/main/mobile-method-router.ts` — JSON-RPC dispatch (`session.*`, `git.*`, `workspace.*`, `annotation.*`, `plan.*`)
- `desktop/src/main/mobile-rpc-adapter.ts` — normalizes RPC params/results between the wire protocol and the desktop services
- `desktop/src/main/mobile-event-bridge.ts` — pushes streaming updates to paired devices
- `desktop/src/main/mobile-secure-transport.ts` — E2EE handshake (must match Swift byte-for-byte on wire constants)
- `desktop/src/main/mobile-keychain.ts` — at-rest key material for the bridge identity / device trust
- `desktop/src/main/mobile-store.ts` — trusted devices + bridge identity (`mobile-access.db` in app userData)
- `desktop/src/main/mobile-device-tools.ts` — USB iOS dev-deploy (`xcodebuild`); `mobile-focus-session.ts` — bring a session to the foreground from the phone
- `desktop/src/main/mobile-git-bridge.ts` — phone-initiated git ops; creates `.constellagent/worktrees/<token>/` at runtime
- `ios/Constellagent/Constellagent/Services/ConstellagentService+ProtocolMapping.swift` — maps legacy codex RPC names to bridge methods at `sendRequest`
- `ios/Constellagent/Constellagent/Services/ConstellagentService+Incoming*.swift` — rewrites incoming bridge event names back to codex shapes
- `ios/Constellagent/README.md` — port status, deferred remodex features, verification checklist

**Secure transport constants** (keep Swift and TypeScript in sync):

- `HANDSHAKE_TAG = "constellagent-e2ee-v1"`
- `PAIRING_QR_VERSION = 2`
- `SECURE_PROTOCOL_VERSION = 1`

### Enabling the desktop bridge

- UI: Settings → Mobile
- Env: `CONSTELLAGENT_MOBILE_ACCESS=1` (optional: `CONSTELLAGENT_MOBILE_HOST`, `CONSTELLAGENT_MOBILE_PORT`, `CONSTELLAGENT_MOBILE_TOKEN`, `CONSTELLAGENT_MOBILE_KEYCHAIN_DIR`)
- IPC (`desktop/src/shared/ipc-channels.ts`): `MOBILE_GET_STATUS`, `MOBILE_LIST_TRUSTED_DEVICES`, `MOBILE_REVOKE_TRUSTED_DEVICE`, `MOBILE_CREATE_PAIRING_PAYLOAD`, `MOBILE_FOCUS_SESSION`, `MOBILE_WORKSPACE_CREATED`, and the USB dev-deploy pair `MOBILE_LIST_USB_DEVICES` / `MOBILE_DEPLOY_IOS_APP`

### Local USB dev deploy

`mobile-device-tools.ts` can build and install the dev iOS app (`com.tridhatri.constellagent.devlocal`, scheme `Constellagent`) onto a USB-attached iPhone via `xcodebuild` (derived data at `/tmp/ConstellagentDerivedData`). Surfaced in Settings → Mobile through `MOBILE_LIST_USB_DEVICES` / `MOBILE_DEPLOY_IOS_APP`.

### iOS development

Requires Xcode. Build from the project directory:

```bash
cd ios/Constellagent
xcodebuild -project Constellagent.xcodeproj -scheme Constellagent \
  -destination 'generic/platform=iOS' build
```

Simulator tests (when the scheme is clean):

```bash
xcodebuild test -project Constellagent.xcodeproj -scheme Constellagent \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

Local relay override for dev pairing: copy `ios/Constellagent/BuildSupport/PrivateOverrides.xcconfig.example` → `PrivateOverrides.xcconfig` (gitignored) and set `PHODEX_DEFAULT_RELAY_URL`.

Manual pairing smoke test: enable Mobile on desktop → scan QR from the app → confirm `session.list` reflects `conductor-chat.db` state → start a session and observe streaming.

### Mobile protocol package

```bash
bun run build:constellagent-mobile-protocol
bun test packages/constellagent-mobile-protocol/src/index.test.ts
```

When changing RPC params, events, or pairing payloads, update **all three**: the Zod schemas in `packages/constellagent-mobile-protocol`, the desktop router/event bridge, and the Swift protocol mapper (`ConstellagentService+ProtocolMapping.swift` / incoming parsers in `ConstellagentService+Incoming*.swift`).

## Workspace storage

Constellagent does **not** create a workspace-level `.constellagent/` directory for context capture or session history. The AgentFS/libSQL data that still exists lives under the repo's **`.git/`** directory.

**Exception:** the mobile bridge creates `.constellagent/worktrees/<token>/` at runtime for phone-initiated git operations (`mobile-git-bridge.ts`; detected via `mobile-workspace-registry.ts`). This is a runtime artifact, not committed context.

Databases (see `desktop/CLAUDE.md` for the full table): `review-annotations.db` (git common dir), `<sessionId>.db` (repo `.git/`), and `conductor-chat.db` / `mobile-access.db` (app `userData`).

## Cachebro (MCP — optional, per-machine)

`cachebro` is a `desktop/` dependency (CLI MCP server `cachebro serve`) exposing `read_file`, `read_files`, `cache_status`, `cache_clear` tools that return diffs instead of full re-reads. It is **not** wired up by any committed config file in this repo; configure it once per machine with `npx cachebro init` (writes your global `~/.claude.json` / Cursor MCP config). When the cachebro tools are available, prefer them over raw file reads to save tokens.

## Bundled agent skills

**Point your Cursor, Codex, or other agent harness at this file** (`AGENTS.md` at the repo root) so setup instructions are available during onboarding.

### One-time setup after clone

```bash
bun run setup
```

This installs bundled Conductor canvas skills and the optional hunk-review skill into **gitignored** agent directories:

| Harness | Installed skill | Path |
|---------|-----------------|------|
| Codex | `conductor-canvas-codex` | `.codex/skills/conductor-canvas-codex/` |
| Cursor | `conductor-canvas-cursor` | `.cursor/skills/conductor-canvas-cursor/` |
| Claude / Cursor / Gemini | `hunk-review` (optional, fetched from `modem-dev/hunk`) | `desktop/.claude/skills/hunk-review/` (+ symlinks for Cursor/Gemini) |

Source files for the bundled canvas skills live under `desktop/skills/` (tracked in git: `conductor-canvas-codex/`, `conductor-canvas-cursor/`). The setup scripts symlink them into agent dirs locally — nothing is written into git by the app.

### Conductor chat formatting

Conductor markdown and canvas formatting is **app-managed** (inline prompt prefixes at runtime). Bundled canvas skills supplement SDK skill discovery when running Cursor Agent SDK or Codex SDK in this repo; they are not required for the Conductor UI itself.

### Settings catalog

Constellagent Settings can catalog additional skill directories and subagent files (stored in AgentFS KV). The app does **not** symlink them into your project — install into agent dirs locally using the same pattern as above.

## Review annotations (human ↔ agent)

The **Review Changes** panel and the **Changes** diff use **review annotations** backed by a local libSQL database (`review-annotations.db` in the git common dir). The `constell-annotate` CLI (from `@tridha643/review-annotations`) is the agent-facing tool. Desktop consumes the library via a workspace dependency (`workspace:*`) — no global install needed for the Electron app.

- **In the desktop UI:** After non-trivial edits, add review notes on the relevant **new-side** lines (or old-side when appropriate). The diff shows **what** changed; comments explain **why** something needs attention.
- **In a terminal (Claude Code, Codex, Cursor, etc.):** Use `constell-annotate` — no daemon, no session resolution needed.

**Adding a comment (single command):**

```bash
constell-annotate add --file src/foo.ts --new-line 42 --summary "Why this change" --author "claude-code"
```

**Line ranges:**

```bash
constell-annotate add --file src/foo.ts --new-line 42-58 --summary "Refactored block" --author "cursor"
```

**Old-side (deletion) comments:**

```bash
constell-annotate add --file src/foo.ts --old-line 10 --summary "Removed deprecated path" --author "codex"
```

**Other commands:**

```bash
constell-annotate list [--file <path>] [--json] [--include-stale]
constell-annotate remove <id>
constell-annotate clear [--file <path>]
constell-annotate clean-deleted
constell-annotate resolve <id>
constell-annotate unresolve <id>
```

**Repo-scoped memories** (same global `--db` / `--workspace-id` as above; full flags in `packages/review-annotations/README.md`):

```bash
constell-annotate add-memory --summary "..." [--details "..." --key ... --author ... --branch ... --worktree ...]
constell-annotate list-memories [--key ... --author ... --branch ... --worktree ...] [--json]
constell-annotate search-memories --query "..." [--key ... --author ... --branch ... --worktree ...] [--json]
constell-annotate remove-memory <id>
```

`search-memories` uses **FTS5** token search over memory text when the SQLite build supports it, with **`LIKE` fallback** documented in the package README. This is the same **`constell-annotate`** binary used for **review annotations** (`add`, `list`, `remove`, …) on code changes.

### Validation

By default, `add` validates that the target line is inside a `git diff HEAD` hunk. Use `--force` to bypass (e.g. for bulk notes or when the diff base differs).

### Where comments are stored

- In Constellagent-managed repos: `<git-common-dir>/review-annotations.db`
- In standalone CLI use: `~/.local/share/constellagent/review-annotations.db`, scoped by `repo_root`
- Comments persist in SQLite — no daemon or watch process needed

### Author tagging (required)

**Always pass `--author "<agent-name>"` when adding comments** (e.g. `--author "claude-code"`, `--author "cursor"`, `--author "codex"`, `--author "gemini"`, `--author "opencode"`). This tags review notes so human reviewers can distinguish AI annotations from human comments in the UI. Omitting `--author` makes comments appear as human-authored.

In the Review Changes panel, **AI-authored comments are display-only** (non-toggleable context) and are never included in the text submitted to the agent; only **selected human** comments are submitted.

### Install (standalone CLI)

```bash
npm i -g @tridha643/review-annotations
```

Shared types: `desktop/src/shared/diff-annotation-types.ts`.

## Mandatory AI annotations on code changes

After a successful build and **before** reporting work done, annotate **every source file you modified** with at least one `constell-annotate add … --author "<agent-name>"` comment explaining **why** the change was made (not what). Skip auto-generated files (`bun.lock`). Failure to annotate is equivalent to leaving the task incomplete.

## Mandatory Sendblue CLI notifications

**This requirement applies in every repository where constellagent is in use — not just the constellagent codebase itself.**

**After every plan creation and after every task completion, agents MUST send a Sendblue CLI notification to your configured E.164 recipient (set locally; do not commit personal numbers). This is required work, not optional polish.**

- Plan created notification — **send immediately when the plan is written, before implementation begins:**

```bash
sendblue send +<YOUR_E164_RECIPIENT> "<agent-name> <plan-topic-name> plan created"
```

- Task complete notification:

```bash
sendblue send +<YOUR_E164_RECIPIENT> "<agent-name> <plan-topic-name> is over"
```

- Use the concrete harness name for `<agent-name>` such as `claude-code`, `codex`, `gemini`, or `cursor`.
- Use the plan title for `<plan-topic-name>` when one exists; otherwise use a short task topic derived from the user request.
- Retry the `sendblue send` command up to 3 times if it fails.
- If all retries fail, the agent must say so explicitly in its final response with the failure string. Silent failure is not allowed.
