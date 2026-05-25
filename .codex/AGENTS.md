# Constellagent — Codex Agent Context

**Authoritative instructions live in the repo-root `../AGENTS.md`.** This file is the Codex-specific companion; read root `AGENTS.md` (and `desktop/CLAUDE.md` for the desktop service map) for the full policy. Use `--author "codex"` on every annotation.

## Session & activity context

This repo does **not** ship `.constellagent/context/*.md` or `.constellagent/sessions/` files. AgentFS/libSQL data lives under the repo's **`.git/`** directory (DB table in `desktop/CLAUDE.md`). The mobile bridge may create `.constellagent/worktrees/<token>/` at runtime — that is a runtime artifact, not committed context.

## Cachebro (MCP — optional, per-machine)

Cachebro is **not** auto-configured by any committed file in this repo. Configure it once per machine with `npx cachebro init`. When its tools are available, prefer the cachebro MCP tools (`read_file`, `read_files`, `cache_status`, `cache_clear`) over raw file reads to save tokens.

## Review annotations (human ↔ agent)

The **Review Changes** panel and the **Changes** diff use **review annotations** backed by a local libSQL database (`review-annotations.db` in the git common dir). The `constell-annotate` CLI (from `@tridha643/review-annotations`) is the agent-facing tool — no daemon, no session resolution needed. (The legacy `hunk` CLI is no longer used.)

```bash
constell-annotate add --file src/foo.ts --new-line 42 --summary "Why this change" --author "codex"
constell-annotate add --file src/foo.ts --new-line 42-58 --summary "Refactored block" --author "codex"
constell-annotate list [--file <path>] [--json] [--include-stale]
constell-annotate remove <id>
constell-annotate clear [--file <path>]
constell-annotate resolve <id>
```

Install (standalone): `npm i -g @tridha643/review-annotations`. Shared types: `desktop/src/shared/diff-annotation-types.ts`.

**Always pass `--author "codex"`** so human reviewers can distinguish AI annotations. **AI annotations are non-toggleable:** comments with an `author` field are display-only context in the Review Changes panel and are never included in submission text. Only human comments (no `author`) have checkboxes and can be selected for submission.

**Mandatory:** after a successful build and before reporting work done, annotate **every source file you modified** with at least one comment explaining **why** (not what). Skip auto-generated files (`bun.lock`).

## Mandatory Sendblue CLI notifications

Send a Sendblue CLI notification to your configured E.164 recipient (set locally; **do not commit personal numbers**) when a plan is created and again when the task is over.

```bash
sendblue send +<YOUR_E164_RECIPIENT> "codex <plan-topic-name> plan created"
sendblue send +<YOUR_E164_RECIPIENT> "codex <plan-topic-name> is over"
```

- Use the plan title for `<plan-topic-name>` when available; otherwise use a short task topic.
- Retry up to 3 times on failure.
- If all retries fail, Codex must say so explicitly in the final response with the failure text.
