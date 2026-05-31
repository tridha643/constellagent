# Constellagent — Codex Agent Context

**Authoritative instructions live in the repo-root `../AGENTS.md`.** This file is the Codex-specific companion; read root `AGENTS.md` (and `desktop/CLAUDE.md` for the desktop service map) for the full policy.

## Session & activity context

This repo does **not** ship `.constellagent/context/*.md` or `.constellagent/sessions/` files. Embedded libSQL/SQLite data lives under the repo's **`.git/`** directory (DB table in `desktop/CLAUDE.md`). The mobile bridge may create `.constellagent/worktrees/<token>/` at runtime — that is a runtime artifact, not committed context.

## Token hygiene (faster + cheaper turns)

In this repo's agent traces, **~89% of tokens are tool input/output, not model reasoning** — shell/terminal I/O is ~66% (`exec_command` alone is ~half of everything) and file reads ~14%. The cheapest speedup is to stop feeding the model output it doesn't need:

- **Cap noisy command output** — pipe builds/tests/logs through `tail`/`grep` (`bun run build 2>&1 | tail -40`); prefer quiet reporters.
- **Never re-dump a long-running / interactive process's scrollback** — re-capturing a dev server or watcher re-sends the same ~10k-token buffer; read only new lines.
- **Read once, target line ranges** — hot files were re-read 4–7× per session; rely on context already in the thread.
- **Batch edits, then verify once** instead of rebuilding after every micro-edit.
- **Images are expensive** (a screenshot ≈ 35k+ tokens) — only attach when text/logs can't answer it.

See **`desktop/CLAUDE.md` → Token hygiene** for the full repo-specific breakdown.
