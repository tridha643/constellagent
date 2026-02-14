#!/bin/bash
# SessionStart hook: injects previous session context from git-based context repo
WS_ID="${AGENT_ORCH_WS_ID:-}"
[ -z "$WS_ID" ] && exit 0

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
[ -z "$CWD" ] && exit 0

REPO="$CWD/.constellagent"
[ ! -d "$REPO/.git" ] && exit 0

WS_SLIDING="$REPO/context/sliding-window-${WS_ID}.md"
SLIDING="$REPO/context/sliding-window.md"
ACTIVITY="$REPO/context/activity.md"

# Prefer per-workspace sliding window, then global, then activity.md
if [ -n "$WS_ID" ] && [ -f "$WS_SLIDING" ]; then
  CONTEXT=$(cat "$WS_SLIDING" | head -c 4000)
elif [ -f "$SLIDING" ]; then
  CONTEXT=$(cat "$SLIDING" | head -c 4000)
elif [ -f "$ACTIVITY" ]; then
  CONTEXT=$(tail -30 "$ACTIVITY")
else
  exit 0
fi
[ -z "$CONTEXT" ] && exit 0

# Tag session start for checkpointing
git -C "$REPO" -c user.name=Constellagent -c user.email=noreply@constellagent \
  tag "session-start-$(date +%s)" 2>/dev/null

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: ("Previous session context:\n" + $ctx)
  }
}'
