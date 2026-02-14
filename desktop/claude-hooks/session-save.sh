#!/bin/bash
# Stop hook: captures session_id for later resume + tags session end in context repo
WS_ID="${AGENT_ORCH_WS_ID:-}"
[ -z "$WS_ID" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

# Save session ID (existing logic)
SESSION_DIR="${CONSTELLAGENT_SESSION_DIR:-/tmp/constellagent-sessions}"
mkdir -p "$SESSION_DIR"
printf '%s\n' "$SESSION_ID" > "$SESSION_DIR/$WS_ID.claude-code"

# Tag session end in context repo
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -n "$CWD" ] && [ -d "$CWD/.constellagent/.git" ]; then
  SESSION_FILE="$CWD/.constellagent/sessions/${WS_ID}-$(date +%s).md"
  {
    echo "# Session End: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    echo "## Recent Activity"
    tail -20 "$CWD/.constellagent/context/activity.md" 2>/dev/null
  } > "$SESSION_FILE"

  git -C "$CWD/.constellagent" add -A 2>/dev/null
  git -C "$CWD/.constellagent" -c user.name=Constellagent -c user.email=noreply@constellagent \
    commit -q --no-gpg-sign -m "session-end: $WS_ID" 2>/dev/null
  git -C "$CWD/.constellagent" -c user.name=Constellagent -c user.email=noreply@constellagent \
    tag "session-end-$(date +%s)" 2>/dev/null
fi
