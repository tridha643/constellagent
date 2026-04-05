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

**Recommended flow:** resolve a session, then pass it explicitly (avoids “multiple sessions match” when several clients share the same repo):

```bash
hunk session list
hunk session comment add <session-id> --file src/foo.ts --new-line 42 --summary "Why" --author "claude-code"
```

### CLI-only resolver (`hunk` + `jq`)

Same selection rule as [`scripts/hunk-agent.sh`](scripts/hunk-agent.sh): take the **first** session whose `repoRoot` equals the current git top-level (when several sessions match one repo, behavior matches the script—first JSON entry wins).

Uses only the `hunk` binary and `jq` (no `curl`). The daemon and a session for this repo must **already** exist; if not, use **`hunk-agent.sh`** or open the repo in Constellagent so a watch session is started.

```bash
REPO="$(git rev-parse --show-toplevel)"
SID="$(hunk session list --json | jq -r --arg repo "$REPO" '[.sessions[] | select(.repoRoot == $repo)][0].sessionId // empty')"
hunk session comment add "$SID" --file src/foo.ts --new-line 42 --summary "Why" --author "claude-code"
```

### Adding comments: reload + line range discovery

Sessions can go stale (e.g. tracking an old HEAD). **Always reload before annotating** so hunk sees your latest uncommitted changes:

```bash
hunk session reload "$SID" -- diff
```

**`--new-line` must be inside a diff hunk's new-side range.** Arbitrary file line numbers outside changed hunks are rejected with _"No new diff hunk covers line N"_. Before commenting on a file, discover valid ranges:

```bash
# Navigate to the file's first hunk and read its range
hunk session navigate "$SID" --file <path> --hunk 1
hunk session context "$SID"
# Output includes "New range: X..Y" — use any line in [X, Y]
```

For files with multiple hunks, iterate `--hunk 1`, `--hunk 2`, etc. to find the range that covers the line you want to annotate. Use `hunk session get "$SID" --json` to see all files and their `hunkCount` in one call.

### Optional: `hunk-agent` wrapper

[`scripts/hunk-agent.sh`](scripts/hunk-agent.sh) is a thin POSIX helper that starts the daemon if needed, ensures a session exists, resolves one session id for the repo (including when multiple match), then delegates to `hunk session`. Use it when you want `--repo .` without copying a `session-id`:

```bash
sh scripts/hunk-agent.sh comment add --repo . --file src/foo.ts --new-line 42 --summary "Why" --author "claude-code"
```

Prefer the explicit `session-id` flow above when you already know which session to target.

### Proactive sessions

Constellagent desktop auto-starts hunk sessions for all active workspaces on launch and when workspaces are added. Agents running `hunk session --repo .` should usually find a session already running.

### Author tagging (required)

**Always pass `--author "<agent-name>"` when adding comments** (e.g. `--author "claude-code"`, `--author "cursor"`, `--author "codex"`, `--author "gemini"`, `--author "opencode"`). This tags review notes so human reviewers can distinguish AI annotations from human comments in the UI. Omitting `--author` makes comments appear as human-authored.

### Install & update

Constellagent **installs the `hunk` CLI automatically** when needed (e.g. when you open a workspace or use Review Changes), unless running in automated tests. It also **checks for updates on launch** and can prompt via a toast to upgrade when a newer `hunkdiff` is on npm.

**Local skill path (not committed; gitignored):** after **`bun run setup`** or **`sh scripts/install-hunk-skill.sh`**, the same upstream `SKILL.md` is present at **`desktop/.claude/skills/hunk-review/SKILL.md`**, with symlinks **`.cursor/skills/hunk-review`** and **`.gemini/skills/hunk-review`**. Override revision with **`HUNK_SKILL_REF`** when running the install script (defaults to `main`).

Shared types: `desktop/src/shared/diff-annotation-types.ts`.
