# Constellagent Cross-Agent Context

## Session & Activity Context
Read these files to see what other agents (and you) have been doing recently:
- `.constellagent/context/sliding-window.md` — Compact table of last 20 agent actions across all agents
- `.constellagent/context/agent-context.md` — Rich context summary (files touched, tool details, activity timeline)
- `.constellagent/sessions/` — Session-end summaries with timestamps

## Cachebro (MCP — auto-configured)
Cachebro is pre-configured via `npx cachebro init`. Use the cachebro MCP tools (`read_file`, `read_files`, `cache_status`, `cache_clear`) instead of raw file reads to save tokens.

## Context Database
Agent tool calls and activity are recorded in `.constellagent/constellagent.db` (libSQL/SQLite via AgentFS).
The `entries` table stores: workspace_id, agent_type, session_id, tool_name, tool_input, file_path, tool_response, timestamp.

## Review annotations (human ↔ agent)

The **Review Changes** panel and the **Changes** diff use **review annotations** backed by a local libSQL database. The `constell-annotate` CLI (from `@tridha643/review-annotations`) is the agent-facing tool — no daemon, no session resolution needed.

```bash
constell-annotate add --file src/foo.ts --new-line 42 --summary "Why this change" --author "gemini"
constell-annotate add --file src/foo.ts --new-line 42-58 --summary "Refactored block" --author "gemini"
constell-annotate list [--file <path>] [--json] [--include-stale]
constell-annotate remove <id>
constell-annotate clear [--file <path>]
constell-annotate resolve <id>
```

Install: `npm i -g @tridha643/review-annotations`

**AI annotations are non-toggleable:** Comments with an `author` field are display-only context in the Review Changes panel — they are never included in submission text sent to the agent. Only human comments (no `author`) have checkboxes and can be selected for submission.

## Mandatory Sendblue CLI notifications

**Gemini must send Sendblue CLI notifications to your configured E.164 recipient (set locally; do not commit personal numbers) for both binary states: plan created and task over.**

```bash
sendblue send +<YOUR_E164_RECIPIENT> "gemini <plan-topic-name> plan created"
sendblue send +<YOUR_E164_RECIPIENT> "gemini <plan-topic-name> is over"
```

- Use the plan title for `<plan-topic-name>` when available; otherwise use a short task topic.
- Retry up to 3 times on failure.
- If all retries fail, Gemini must say so explicitly in the final response with the failure text.

Shared types: `desktop/src/shared/diff-annotation-types.ts`.
