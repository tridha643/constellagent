#!/bin/bash
# Stop hook: capture session_id for later resume
WS_ID="${AGENT_ORCH_WS_ID:-}"
[ -z "$WS_ID" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

# Save session ID (existing logic)
SESSION_DIR="${CONSTELLAGENT_SESSION_DIR:-/tmp/constellagent-sessions}"
mkdir -p "$SESSION_DIR"
printf '%s\n' "$SESSION_ID" > "$SESSION_DIR/$WS_ID.claude-code"
