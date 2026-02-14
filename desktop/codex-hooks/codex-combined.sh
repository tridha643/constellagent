#!/bin/bash
# Combined Codex hook: handles both notification/activity AND context capture.
# Installed as the single `notify` command in ~/.codex/config.toml when context capture is enabled.
# When context capture is disabled, notify.sh is installed instead.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_HOOKS_DIR="$SCRIPT_DIR/../agent-hooks"

WS_ID="${AGENT_ORCH_WS_ID:-}"
[ -z "$WS_ID" ] && exit 0

# ── Notification duties (always run) ──
NOTIFY_DIR="${CONSTELLAGENT_NOTIFY_DIR:-/tmp/constellagent-notify}"
mkdir -p "$NOTIFY_DIR"
TARGET="$NOTIFY_DIR/$(date +%s%N)-$$"
TMP_TARGET="${TARGET}.tmp"
printf '%s\n' "$WS_ID" > "$TMP_TARGET"
mv "$TMP_TARGET" "$TARGET"

# Clear Codex-specific activity markers for this workspace.
ACTIVITY_DIR="${CONSTELLAGENT_ACTIVITY_DIR:-/tmp/constellagent-activity}"
rm -f "$ACTIVITY_DIR/$WS_ID.codex."*

# Legacy cleanup: remove old shared marker only if Claude isn't marked active.
if [ ! -f "$ACTIVITY_DIR/$WS_ID.claude" ]; then
  rm -f "$ACTIVITY_DIR/$WS_ID"
fi

# ── Context capture ──
if [ -f "$AGENT_HOOKS_DIR/shared.sh" ]; then
  source "$AGENT_HOOKS_DIR/shared.sh"

  # Codex notify passes a payload as first argument or on stdin.
  # The payload may be JSON (newer Codex) or plain text (older Codex).
  if [ -n "$1" ]; then
    PAYLOAD="$1"
  else
    PAYLOAD=$(cat)
  fi

  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Detect if payload is valid JSON
  IS_JSON=false
  if echo "$PAYLOAD" | jq empty 2>/dev/null; then
    IS_JSON=true
  fi

  # Codex notify payload format (JSON):
  #   { "type": "agent-turn-complete",
  #     "turn-id": "...",
  #     "cwd": "/path/to/project",
  #     "input-messages": ["user prompt here"],
  #     "last-assistant-message": "assistant response here" }
  if [ "$IS_JSON" = true ]; then
    CWD=$(echo "$PAYLOAD" | jq -r '.cwd // empty' 2>/dev/null)
    SESSION_ID=$(echo "$PAYLOAD" | jq -r '."turn-id" // .session_id // .conversation_id // empty' 2>/dev/null)
    EVENT=$(echo "$PAYLOAD" | jq -r '.type // .event // "agent-turn-complete"' 2>/dev/null)
  else
    CWD=""
    SESSION_ID=""
    EVENT="agent-turn-complete"
  fi

  [ -z "$CWD" ] && CWD=$(pwd)
  
  if [ -d "$CWD/.constellagent" ]; then
    AGENT_TYPE="codex"

    case "$EVENT" in
      agent-turn-complete)
        if [ "$IS_JSON" = true ]; then
          # Extract user prompt from input-messages array and assistant response
          USER_MSG=$(echo "$PAYLOAD" | jq -r '(."input-messages" // [])[-1] // empty' 2>/dev/null)
          ASST_MSG=$(echo "$PAYLOAD" | jq -r '."last-assistant-message" // .summary // .message // empty' 2>/dev/null)

          # Write the user prompt as a separate entry if present
          if [ -n "$USER_MSG" ]; then
            USER_INPUT=$(jq -nc --arg msg "$USER_MSG" '$msg' | head -c 500)
            write_pending "$CWD" "$AGENT_TYPE" "$SESSION_ID" "UserPrompt" "$USER_INPUT" "" "$TIMESTAMP"
          fi

          # Write the assistant turn
          TOOL_INPUT=$(jq -nc --arg msg "${ASST_MSG:-}" '{summary: (if $msg == "" then null else $msg end)}' | head -c 1000)
        else
          # Plain text message from Codex — wrap it as JSON
          TOOL_INPUT=$(jq -nc --arg msg "$PAYLOAD" '{summary: $msg}' | head -c 1000)
        fi
        write_pending "$CWD" "$AGENT_TYPE" "$SESSION_ID" "AssistantTurn" "$TOOL_INPUT" "" "$TIMESTAMP"

        # Output per-workspace sliding window context for Codex to pick up
        SW_CONTENT=$(read_sliding_window "$CWD")
        if [ -n "$SW_CONTENT" ]; then
          echo "$SW_CONTENT" | jq -Rs '{context: .}' 2>/dev/null
        fi
        ;;
      *)
        if [ "$IS_JSON" = true ]; then
          TOOL_INPUT=$(echo "$PAYLOAD" | jq -c '.' 2>/dev/null | head -c 500)
        else
          TOOL_INPUT=$(jq -nc --arg msg "$PAYLOAD" '{message: $msg}' | head -c 500)
        fi
        write_pending "$CWD" "$AGENT_TYPE" "$SESSION_ID" "$EVENT" "$TOOL_INPUT" "" "$TIMESTAMP"
        ;;
    esac
  fi
fi

exit 0
