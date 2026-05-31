# Constellagent App — Universal Agent Instructions

These instructions apply to **any repository** where the constellagent app is in use. They govern all coding agents regardless of which codebase is being worked on.

Shared instructions for all coding agents — session context and **this repo's mobile layout** — are in **`AGENTS.md`** at the repository root (when available).

## Constellagent monorepo (this repository)

Bun workspaces (`["packages/*", "desktop"]`). For a file-by-file service map of the desktop app, see **`desktop/CLAUDE.md`**.

| Area | Path | Notes |
|------|------|-------|
| Desktop app (primary) | `desktop/` | Electron; `bun run dev` from repo root. Deep architecture, service/renderer maps, prosemark markdown engine, and the OpenSpec (`/opsx:*`) workflow: `desktop/CLAUDE.md` |
| iOS companion | `ios/Constellagent/` | SwiftUI; see `ios/Constellagent/README.md` |
| Mobile wire protocol | `packages/constellagent-mobile-protocol/` | `@constellagent/mobile-protocol`; Zod schemas; built on `bun install` |
| Review annotations | `packages/review-annotations/` | `@tridha643/review-annotations`; ships the `constell-annotate` CLI |
| Pi GUI packages | `packages/pi-gui-{session-driver,catalogs,pi-sdk-driver}/` | `@pi-gui/*` session driver + catalogs |
| Pi CLI extensions | `packages/pi-constell/`, `packages/pi-inline-skill-autocomplete/` | plan mode + inline skill autocomplete for `pi` |
| Landing page | `landing-page/` | static marketing site (`bunx serve landing-page`) |
| Desktop mobile bridge | `desktop/src/main/mobile-*.ts` | Tailscale-local WS + E2EE; Settings → Mobile |

The iPhone app talks to the desktop bridge over secure WebSocket. Shared contracts live in `@constellagent/mobile-protocol`; Swift adapts via `ConstellagentService+ProtocolMapping.swift`. When editing RPC shapes, keep TypeScript, the desktop router (`mobile-method-router.ts`), and Swift mapping in sync.

**Verification commands (mobile-related)**

```bash
bun test packages/constellagent-mobile-protocol/src/index.test.ts
bun test desktop/src/main/mobile-*.test.ts
cd ios/Constellagent && xcodebuild -project Constellagent.xcodeproj -scheme Constellagent -destination 'generic/platform=iOS' build
```

Enable the bridge with `CONSTELLAGENT_MOBILE_ACCESS=1` or Settings → Mobile. Local iOS dev relay URL: `ios/Constellagent/BuildSupport/PrivateOverrides.xcconfig` (copy from `.example`; gitignored).

## Comment selection in Review Changes

Human comments in the Review Changes panel (Cmd+Shift+R) are individually selectable via checkboxes. Only **selected** human comments are included in the text submitted to the agent. AI-authored comments (those with an `author` field) are **non-toggleable** — they are display-only context in the diff and are never included in the submission text.

## Plan policies

1. **Verification loops**: Every plan must include a verification section with both automated tests (`bun run test`, specific test files) and manual test steps.

## Token hygiene (make agents faster + cheaper)

In this repo's agent traces, **~89% of tokens are tool input/output, not model reasoning** (shell/terminal I/O ~66%, file reads ~14%). The cheapest speedup is to stop feeding agents output they don't need. Universal rules — see **`desktop/CLAUDE.md` → Token hygiene** for the detailed repo-specific version:

- **Cap noisy output**: pipe builds/tests/logs through `tail`/`grep`; prefer quiet reporters (`--reporter=dot`, `--silent`).
- **Never re-dump a long-running/interactive process's scrollback** — read only new lines.
- **Read once, target line ranges** instead of re-reading whole files.
- **Batch edits, then verify once** instead of rebuilding after every micro-edit.
- **Avoid images unless necessary** (a screenshot ≈ 35k+ tokens); prefer Mermaid for diagrams.

## Session & activity context

This repo does **not** create a `.constellagent/` directory for context capture or session history. Embedded libSQL/SQLite data that still exists lives under the repo's **`.git/`** (DB table in `desktop/CLAUDE.md`). Only legacy repos that still ship `.constellagent/context/*.md` or `.constellagent/sessions/` files should have them read when present.
