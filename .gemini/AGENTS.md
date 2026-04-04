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

## Hunk annotations (review context for humans)

Constellagent’s hunk review UI reads **`.constellagent/annotations.json`**. After you make **non-trivial** code changes, add entries there so human reviewers see **why** you changed things in the HunkReview panel (the diff already shows **what** changed).

### Schema (`DiffAnnotationsFile`, version 1)

Persist a single JSON object:

```json
{
  "version": 1,
  "annotations": [
    {
      "id": "da_550e8400-e29b-41d4-a716-446655440000",
      "filePath": "src/example.ts",
      "side": "additions",
      "lineNumber": 42,
      "body": "Extracted validation into a helper so both handlers stay in sync and we only fix bugs in one place.",
      "createdAt": "2026-04-04T12:00:00.000Z",
      "resolved": false
    }
  ]
}
```

Optional field per annotation: `lineEnd` (number, inclusive end line when the comment spans multiple lines).

### Rules

- Annotate **meaningful** edits only — skip trivial renames, formatting-only changes, or obvious one-line fixes.
- `side` is almost always **`"additions"`** (you are explaining new or modified lines).
- `lineNumber` should anchor the note on the most relevant **new** line (additions side).
- `body`: explain **rationale and tradeoffs**, not a repeat of the diff.
- If `.constellagent/annotations.json` already exists, **merge** new annotations into the `annotations` array — **do not** replace the whole file unless you intend to discard prior notes.
- **IDs**: use the `da_` prefix format from `generateAnnotationId()` in `desktop/src/shared/diff-annotation-types.ts` — e.g. `da_<uuid>` or `da_<timestamp>_<random>` when UUID is unavailable.

Canonical TypeScript types: `desktop/src/shared/diff-annotation-types.ts`.
