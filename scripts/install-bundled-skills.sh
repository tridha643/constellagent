#!/usr/bin/env sh
# Install bundled Constellagent skills into gitignored agent dirs.
# Source of truth: desktop/skills/* (tracked in git).

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT/.codex/skills" "$ROOT/.cursor/skills"

ln -sfn "../../desktop/skills/conductor-canvas-codex" \
  "$ROOT/.codex/skills/conductor-canvas-codex"

ln -sfn "../../desktop/skills/linear-local-first-architecture" \
  "$ROOT/.codex/skills/linear-local-first-architecture"

ln -sfn "../../desktop/skills/conductor-rewrite-performance" \
  "$ROOT/.codex/skills/conductor-rewrite-performance"

ln -sfn "../../desktop/skills/conductor-canvas-cursor" \
  "$ROOT/.cursor/skills/conductor-canvas-cursor"

echo "Installed bundled Constellagent skills"
