#!/usr/bin/env sh
# Dev entrypoint (wraps `bun run dev`): starts the local agentation-mcp server
# for the Agentation panel, then builds the mobile protocol and runs the desktop
# Electron dev server in the foreground. Set CONSTELLAGENT_NO_AGENTATION=1 to
# skip the agentation server.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

. "$ROOT/scripts/agentation-dev.sh"
start_agentation_dev
trap stop_agentation_dev EXIT INT TERM

bun run --cwd "$ROOT" build:constellagent-mobile-protocol
bun run --cwd "$ROOT/desktop" dev
