#!/usr/bin/env sh
# Install bundled Constellagent Conductor canvas skills into gitignored agent dirs.
# Source of truth: desktop/skills/conductor-canvas-* (tracked in git).

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT/.codex/skills" "$ROOT/.cursor/skills"

ln -sfn "../../desktop/skills/conductor-canvas-codex" \
  "$ROOT/.codex/skills/conductor-canvas-codex"

ln -sfn "../../desktop/skills/conductor-canvas-cursor" \
  "$ROOT/.cursor/skills/conductor-canvas-cursor"

echo "Installed bundled Conductor canvas skills (codex + cursor)"
