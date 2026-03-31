#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOC_PATH="$DESKTOP_DIR/docs/automations-verification.md"

cd "$DESKTOP_DIR"

echo "[verify:automations] building desktop app"
bun run build

echo "[verify:automations] running headless automations smoke test"
bun run test:automations

echo
echo "[verify:automations] automated checks passed"
echo "[verify:automations] manual smoke checklist: $DOC_PATH"
echo "[verify:automations] optional full-app e2e: bun run test:automations:e2e"
