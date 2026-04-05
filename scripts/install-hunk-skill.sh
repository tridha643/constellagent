#!/usr/bin/env sh
# Fetch upstream modem-dev/hunk hunk-review skill into gitignored paths and symlink for Cursor/Gemini.
# Override branch/tag/commit: HUNK_SKILL_REF=main (default)

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="${HUNK_SKILL_REF:-main}"
URL="https://raw.githubusercontent.com/modem-dev/hunk/${REF}/skills/hunk-review/SKILL.md"

TARGET_DIR="$ROOT/desktop/.claude/skills/hunk-review"
mkdir -p "$TARGET_DIR"
curl -fsSL "$URL" -o "$TARGET_DIR/SKILL.md"

mkdir -p "$ROOT/.cursor/skills" "$ROOT/.gemini/skills"
ln -sfn "../../desktop/.claude/skills/hunk-review" "$ROOT/.cursor/skills/hunk-review"
ln -sfn "../../desktop/.claude/skills/hunk-review" "$ROOT/.gemini/skills/hunk-review"

echo "Installed hunk-review skill (${REF}) -> $TARGET_DIR/SKILL.md"
