# Constellagent App — Universal Agent Instructions

These instructions apply to **any repository** where the constellagent app is in use — not just the constellagent codebase itself. They govern **all** coding agent harnesses (Cursor, Claude Code, Codex, Gemini, OpenCode, etc.).

> **Fast navigation:** This file covers cross-repo policy (mobile, skills, storage) and the monorepo's top-level map. For a file-by-file **service map** of the desktop app (which `*-service.ts` owns which feature), the **markdown engine (prosemark/CodeMirror)**, the **JSON canvas / tool-UI rendering** subsystem (`@json-render/*`), and the **OpenSpec change workflow** (`/opsx:*`), see **`desktop/CLAUDE.md`** → *Main-process service map* / *Renderer map* / *JSON canvas* / *OpenSpec change workflow*. Cursor users: repo rules live in `.cursor/rules/constellagent.mdc`.

## Agent interaction conventions

- When a user asks the agent to "ask me a question", "give me choices", "let me pick", or equivalent, and the harness provides a structured user-input tool, use that tool by default instead of replying with a plain-text question.
- Prefer a short structured question with 2-3 mutually exclusive options and a recommended default when the decision affects which task, files, commands, or workflow the agent should choose.
- Use plain chat instead when the user explicitly asks for a prose-only response, when no structured input tool is available, or when the question is genuinely open-ended and cannot be reduced to useful choices.

## Constellagent monorepo layout (this repository)

Bun workspaces: root `package.json` declares `["packages/*", "desktop"]`.

| Path | Role |
|------|------|
| `desktop/` | Electron macOS app — the primary product (`bun run dev` from repo root). Deep architecture: `desktop/CLAUDE.md` |
| `ios/Constellagent/` | SwiftUI iPhone companion app (Xcode; see `ios/Constellagent/README.md`) |
| `packages/constellagent-mobile-protocol/` | `@constellagent/mobile-protocol` — shared **Zod** schemas / RPC + event types for mobile ↔ desktop |
| `packages/review-annotations/` | `@tridha643/review-annotations` — review-annotation + memory library; ships the **`constell-annotate`** CLI |
| `desktop/src/lib/pi-gui/` | Vendored `@pi-gui/*` sources (`session-driver`, `catalogs`, `pi-sdk-driver`) for Pi Conductor; resolved via electron-vite aliases |
| `packages/pi-constell/` | `pi-constell-plan` — Claude-Code-style plan mode for the `pi` CLI |
| `packages/pi-inline-skill-autocomplete/` | inline skill autocomplete extension for `pi` |
| `landing-page/` | static marketing site (vanilla HTML/CSS/JS; `bunx serve landing-page`) |
| `scripts/` | repo-root shell scripts (skill install, isolated dev, worktree sync) |

**Root scripts** (`package.json`): `bun run setup`, `bun run dev`, `bun run build`, `bun run test`, `bun run dev-isolated`, `bun run dist`, `bun run rebuild`. `dev`/`build` first build `constellagent-mobile-protocol`; mobile-protocol also builds automatically on `bun install` (`postinstall`).

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

Constellagent does **not** create a workspace-level `.constellagent/` directory for context capture or session history. The embedded libSQL/SQLite data that still exists lives under the repo's **`.git/`** directory.

**Exception:** the mobile bridge creates `.constellagent/worktrees/<token>/` at runtime for phone-initiated git operations (`mobile-git-bridge.ts`; detected via `mobile-workspace-registry.ts`). This is a runtime artifact, not committed context.

Databases (see `desktop/CLAUDE.md` for the full table): `review-annotations.db` (git common dir), `<sessionId>.db` (repo `.git/`), and `conductor-chat.db` / `mobile-access.db` (app `userData`).

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

Constellagent Settings can catalog additional skill directories and subagent files (stored in the embedded libSQL KV). The app does **not** symlink them into your project — install into agent dirs locally using the same pattern as above.
