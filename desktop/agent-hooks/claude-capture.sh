#!/bin/bash
# Claude Code hook: captures structured context from all supported events
# Events: SessionStart, SessionEnd, UserPromptSubmit, PostToolUse, PostToolUseFailure,
#         PreToolUse, Stop, SubagentStart, SubagentStop
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/shared.sh"
[ -z "$WS_ID" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
[ -z "$CWD" ] && exit 0
[ ! -d "$CWD/.constellagent" ] && exit 0

AGENT_TYPE="${AGENT_ORCH_AGENT_TYPE:-claude-code}"
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "PostToolUse"')

case "$EVENT" in
  UserPromptSubmit)
    TOOL="UserPrompt"
    TOOL_INPUT=$(echo "$INPUT" | jq -c '.prompt' | head -c 500)
    write_pending "$CWD" "$AGENT_TYPE" "$SESSION_ID" "$TOOL" "$TOOL_INPUT" "" "$TIMESTAMP"
    ;;
  Stop)
    TOOL="AssistantTurn"
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{stop_reason: .stop_reason}')
    write_pending "$CWD" "$AGENT_TYPE" "$SESSION_ID" "$TOOL" "$TOOL_INPUT" "" "$TIMESTAMP"
    ;;
  PostToolUse)
    TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{i: .tool_input}' | head -c 1000)
    TOOL_RESPONSE=$(echo "$INPUT" | jq -c '.tool_response // null' | head -c 1000)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')
    write_pending_full "$CWD" "$AGENT_TYPE" "$SESSION_ID" "$TOOL" "$TOOL_INPUT" "$FILE_PATH" "$TIMESTAMP" "PostToolUse" "$TOOL_RESPONSE"
    ;;
  PreToolUse)
    TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{i: .tool_input}' | head -c 1000)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')
    write_pending_full "$CWD" "$AGENT_TYPE" "$SESSION_ID" "PreToolUse:$TOOL" "$TOOL_INPUT" "$FILE_PATH" "$TIMESTAMP" "PreToolUse" "null"
    ;;
  PostToolUseFailure)
    TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{i: .tool_input, error: .error}' | head -c 1000)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')
    write_pending_full "$CWD" "$AGENT_TYPE" "$SESSION_ID" "PostToolUseFailure:$TOOL" "$TOOL_INPUT" "$FILE_PATH" "$TIMESTAMP" "PostToolUseFailure" "null"
    ;;
  SessionStart)
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{source: .source}')
    write_pending_full "$CWD" "$AGENT_TYPE" "$SESSION_ID" "SessionStart" "$TOOL_INPUT" "" "$TIMESTAMP" "SessionStart" "null"
    ;;
  SessionEnd)
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{reason: .reason}')
    write_pending_full "$CWD" "$AGENT_TYPE" "$SESSION_ID" "SessionEnd" "$TOOL_INPUT" "" "$TIMESTAMP" "SessionEnd" "null"
    ;;
  SubagentStart)
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{subagent_id: .subagent_id, subagent_type: .subagent_type}')
    write_pending_full "$CWD" "$AGENT_TYPE" "$SESSION_ID" "SubagentStart" "$TOOL_INPUT" "" "$TIMESTAMP" "SubagentStart" "null"
    ;;
  SubagentStop)
    TOOL_INPUT=$(echo "$INPUT" | jq -c '{subagent_id: .subagent_id}')
    write_pending_full "$CWD" "$AGENT_TYPE" "$SESSION_ID" "SubagentStop" "$TOOL_INPUT" "" "$TIMESTAMP" "SubagentStop" "null"
    ;;
  *)
    exit 0
    ;;
esac

exit 0
