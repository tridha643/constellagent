# Constellagent — Gemini Agent Context

**Authoritative instructions live in the repo-root `../AGENTS.md`.** This file is the Gemini-specific companion; read root `AGENTS.md` (and `desktop/CLAUDE.md` for the desktop service map) for the full policy.

## Session & activity context

This repo does **not** ship `.constellagent/context/*.md` or `.constellagent/sessions/` files. Embedded libSQL/SQLite data lives under the repo's **`.git/`** directory (DB table in `desktop/CLAUDE.md`). The mobile bridge may create `.constellagent/worktrees/<token>/` at runtime — that is a runtime artifact, not committed context.

## Token hygiene (faster + cheaper turns)

In this repo's agent traces, **~89% of tokens are tool input/output, not model reasoning** — shell/terminal I/O is ~66% and file reads ~14%. The cheapest speedup is to stop feeding the model output it doesn't need:

- **Cap noisy command output** — pipe builds/tests/logs through `tail`/`grep` (`bun run build 2>&1 | tail -40`); prefer quiet reporters.
- **Never re-dump a long-running / interactive process's scrollback** — read only new lines instead of re-capturing the whole buffer.
- **Read once, target line ranges** instead of re-reading whole files.
- **Batch edits, then verify once** instead of rebuilding after every micro-edit.
- **Images are expensive** (a screenshot ≈ 35k+ tokens) — only attach when text/logs can't answer it.

See **`desktop/CLAUDE.md` → Token hygiene** for the full repo-specific breakdown.
