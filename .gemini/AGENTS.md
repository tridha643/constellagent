# Constellagent — shared agent instructions

Instructions for **all** coding agent harnesses (Cursor, Claude Code, Codex, Gemini, etc.).

## Session & activity context

Read these files to see what other agents (and you) have been doing recently:

- `.constellagent/context/sliding-window.md` — Compact table of last 20 agent actions across all agents
- `.constellagent/context/agent-context.md` — Rich context summary (files touched, tool details, activity timeline)
- `.constellagent/sessions/` — Session-end summaries with timestamps

## Cachebro (MCP — auto-configured)

Cachebro is pre-configured via `npx cachebro init`. Use the cachebro MCP tools (`read_file`, `read_files`, `cache_status`, `cache_clear`) instead of raw file reads to save tokens.

## Context database

Agent tool calls and activity are recorded in `.constellagent/constellagent.db` (libSQL/SQLite via AgentFS).

The `entries` table stores: workspace_id, agent_type, session_id, tool_name, tool_input, file_path, tool_response, timestamp.

## Hunk review comments (human ↔ agent)

The **Review Changes** panel and the **Changes** diff use **hunk session** comments (the `hunk` CLI from **`hunkdiff`**). There is no separate annotations JSON file in the app.

- **In the desktop UI:** After non-trivial edits, add review notes on the relevant **new-side** lines (or old-side when appropriate). The diff shows **what** changed; comments explain **why** something needs attention.
- **In a terminal (Claude Code, Codex, Cursor, etc.):** Use **`hunk session *`** only (see upstream skill — do not drive the interactive `hunk diff` TUI from agents). Canonical source: **[modem-dev/hunk `hunk-review` skill](https://github.com/modem-dev/hunk/blob/main/skills/hunk-review/SKILL.md)**.

**Local skill path (not committed; gitignored):** after **`bun run setup`** or **`sh scripts/install-hunk-skill.sh`**, the same upstream `SKILL.md` is present at **`desktop/.claude/skills/hunk-review/SKILL.md`**, with symlinks **`.cursor/skills/hunk-review`** and **`.gemini/skills/hunk-review`**. Override revision with **`HUNK_SKILL_REF`** when running the install script (defaults to `main`).

Constellagent **ensures the `hunk` CLI** when you use workspaces / Review Changes; you do not need to install it by hand. **Recommended:** `hunk session list`, then `hunk session comment add <session-id> … --author "gemini"`. Optional: `sh scripts/hunk-agent.sh … --repo .` when you do not want to pick an id; or **`hunk session list --json` + `jq`** to resolve a session id without `curl` (see **CLI-only resolver** in root **`AGENTS.md`**). An active hunk session for that repo is required: Constellagent’s **Review Changes** starts one; otherwise ask the user to open Hunk per the upstream skill.

**AI annotations are non-toggleable:** Comments with an `author` field are display-only context in the Review Changes panel — they are never included in submission text sent to the agent. Only human comments (no `author`) have checkboxes and can be selected for submission.

## Mandatory Sendblue CLI notifications

**Gemini must send Sendblue CLI notifications to `+18258883809` for both binary states: plan created and task over.**

```bash
sendblue send +18258883809 "gemini <plan-topic-name> plan created"
sendblue send +18258883809 "gemini <plan-topic-name> is over"
```

- Use the plan title for `<plan-topic-name>` when available; otherwise use a short task topic.
- Retry up to 3 times on failure.
- If all retries fail, Gemini must say so explicitly in the final response with the failure text.

Shared types: `desktop/src/shared/diff-annotation-types.ts`.
