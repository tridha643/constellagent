#!/bin/bash
# Hook: captures agent context into git-based context repo + pending SQLite index
# Handles PostToolUse, UserPromptSubmit, and Stop events
WS_ID="${AGENT_ORCH_WS_ID:-}"
[ -z "$WS_ID" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
[ -z "$CWD" ] && exit 0

REPO="$CWD/.constellagent"
[ ! -d "$REPO/.git" ] && exit 0

# Determine event type and extract fields
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "PostToolUse"')
case "$EVENT" in
  UserPromptSubmit)
    TOOL_NAME="UserPrompt"
    TOOL_INPUT=$(echo "$INPUT" | jq -c '.prompt' | head -c 500)
    FILE_PATH=""
    ;;
  Stop)
    TOOL_NAME="AssistantTurn"
    TOOL_INPUT='""'
    FILE_PATH=""
    ;;
  PostToolUse)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{i: .tool_input, o: (.tool_response // null)}' | head -c 1000)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')
    ;;
  *)
    exit 0
    ;;
esac

# Capture project git HEAD
PROJECT_HEAD=$(git -C "$CWD" rev-parse HEAD 2>/dev/null || echo "")

# Append to activity log
AGENT_TYPE="${AGENT_ORCH_AGENT_TYPE:-claude-code}"
ACTIVITY="$REPO/context/activity.md"
printf -- '- [%s] **%s** `%s` (@ %.7s) — %s\n' \
  "$AGENT_TYPE" "$TOOL_NAME" "$TIMESTAMP" "$PROJECT_HEAD" \
  "$(echo "$TOOL_INPUT" | head -c 150)" >> "$ACTIVITY"

# Prune to header + last 50 entries
LINES=$(wc -l < "$ACTIVITY")
if [ "$LINES" -gt 52 ]; then
  { head -1 "$ACTIVITY"; tail -50 "$ACTIVITY"; } > "$ACTIVITY.tmp" && mv "$ACTIVITY.tmp" "$ACTIVITY"
fi

# Track file paths
if [ -n "$FILE_PATH" ]; then
  TOUCHED="$REPO/context/files-touched.md"
  if ! grep -qF "$FILE_PATH" "$TOUCHED" 2>/dev/null; then
    printf -- '- `%s` (%s)\n' "$FILE_PATH" "$TIMESTAMP" >> "$TOUCHED"
    tail -30 "$TOUCHED" > "$TOUCHED.tmp" && mv "$TOUCHED.tmp" "$TOUCHED"
  fi
fi

# Git commit
git -C "$REPO" add -A 2>/dev/null
git -C "$REPO" -c user.name=Constellagent -c user.email=noreply@constellagent \
  commit -q --no-gpg-sign -m "capture: $TOOL_NAME" 2>/dev/null

# Write pending index entry for Electron to pick up (SQLite indexing)
PENDING_DIR="$REPO/.pending"
mkdir -p "$PENDING_DIR"
[ -z "$TOOL_INPUT" ] && TOOL_INPUT="null"
printf '{"ws":"%s","agent":"%s","sid":"%s","tool":"%s","input":%s,"file":"%s","ts":"%s","head":"%s"}\n' \
  "$WS_ID" "$AGENT_TYPE" "$SESSION_ID" "$TOOL_NAME" "$TOOL_INPUT" \
  "${FILE_PATH:-}" "$TIMESTAMP" "$PROJECT_HEAD" \
  > "$PENDING_DIR/$(date +%s%N).json"

# On UserPromptSubmit, inject the sliding window as additional context
# so the agent has fresh cross-agent awareness on every turn
if [ "$EVENT" = "UserPromptSubmit" ]; then
  WS_SLIDING="$REPO/context/sliding-window-${WS_ID}.md"
  SLIDING="$REPO/context/sliding-window.md"
  ACTIVITY_FILE="$REPO/context/activity.md"

  SW_CONTEXT=""
  if [ -n "$WS_ID" ] && [ -f "$WS_SLIDING" ]; then
    SW_CONTEXT=$(cat "$WS_SLIDING" | head -c 4000)
  elif [ -f "$SLIDING" ]; then
    SW_CONTEXT=$(cat "$SLIDING" | head -c 4000)
  elif [ -f "$ACTIVITY_FILE" ]; then
    SW_CONTEXT=$(tail -30 "$ACTIVITY_FILE")
  fi

  if [ -n "$SW_CONTEXT" ]; then
    jq -n --arg ctx "$SW_CONTEXT" '{
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: ("Recent workspace activity:\n" + $ctx)
      }
    }'
    exit 0
  fi
fi

exit 0
