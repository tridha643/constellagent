#!/usr/bin/env sh
# Isolated dev: separate Electron userData per git checkout (parallel worktrees).
# Run from repo root: sh scripts/dev-isolated.sh
# Or: CONSTELLAGENT_ISOLATED_DEV=1 bun run --cwd desktop dev  (no extra scripts needed)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CONSTELLAGENT_ISOLATED_DEV=1

. "$ROOT/scripts/agentation-dev.sh"
start_agentation_dev
trap stop_agentation_dev EXIT INT TERM

# Not `exec` — the trap above must stay alive to clean up the agentation server.
bun run --cwd "$ROOT/desktop" dev
