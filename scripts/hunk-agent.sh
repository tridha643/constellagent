#!/usr/bin/env sh
# hunk-agent: thin wrapper for coding agents.
# Ensures the daemon is running and a session exists for the current repo,
# resolves a single session ID (even when multiple sessions match), then
# delegates to `hunk session *` with the resolved ID.
# When you already have a session id, prefer: hunk session <subcommand> <session-id> ...
#
# Usage: hunk-agent <session-subcommand> [args...]
# Example: hunk-agent comment add --repo . --file src/foo.ts --new-line 42 --summary "Why"
#
# Requires: curl, jq

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DAEMON_URL="${HUNK_MCP_URL:-http://127.0.0.1:47657}"

# ── 1. Ensure daemon is running ──

if ! curl -sf "$DAEMON_URL/health" >/dev/null 2>&1; then
  hunk mcp serve </dev/null >/dev/null 2>&1 &
  TRIES=0
  while [ "$TRIES" -lt 30 ]; do
    sleep 0.2
    curl -sf "$DAEMON_URL/health" >/dev/null 2>&1 && break
    TRIES=$((TRIES + 1))
  done
  if ! curl -sf "$DAEMON_URL/health" >/dev/null 2>&1; then
    echo "hunk-agent: daemon failed to start at $DAEMON_URL" >&2
    exit 1
  fi
fi

# ── 2. List sessions and resolve one for this repo ──

list_sessions() {
  curl -sf -X POST "$DAEMON_URL/session-api" \
    -H 'content-type: application/json' \
    -d '{"action":"list"}' 2>/dev/null || echo '{"sessions":[]}'
}

resolve_session_id() {
  echo "$1" | jq -r \
    --arg repo "$REPO_ROOT" \
    '[.sessions[] | select(.repoRoot == $repo)][0].sessionId // empty'
}

SESSION_JSON="$(list_sessions)"
SESSION_ID="$(resolve_session_id "$SESSION_JSON")"

# ── 3. If no session, spawn one headlessly and wait for registration ──

if [ -z "$SESSION_ID" ]; then
  hunk diff --watch HEAD </dev/null >/dev/null 2>&1 &
  HUNK_PID=$!
  TRIES=0
  while [ "$TRIES" -lt 50 ]; do
    sleep 0.2
    SESSION_JSON="$(list_sessions)"
    SESSION_ID="$(resolve_session_id "$SESSION_JSON")"
    [ -n "$SESSION_ID" ] && break
    TRIES=$((TRIES + 1))
  done

  if [ -z "$SESSION_ID" ]; then
    echo "hunk-agent: no session registered for $REPO_ROOT after 10s (pid $HUNK_PID)" >&2
    echo "hunk-agent: open Hunk in a terminal first, or check 'hunk session list'" >&2
    exit 1
  fi
fi

# ── 4. Rewrite args: strip --repo <path>, insert resolved session ID ──
#
# `hunk session <sub> [<sub2>] <sessionId> [rest...]`
# Subcommand is 1 word (get, context, navigate, reload, list) or
# 2 words when the first word is "comment" (comment add/rm/list/clear).
# We consume those, inject the session ID, then pass everything else through.

# First, strip --repo and its value while preserving all other args.
CLEANED=""
SKIP_NEXT=false
for arg in "$@"; do
  if $SKIP_NEXT; then SKIP_NEXT=false; continue; fi
  case "$arg" in --repo) SKIP_NEXT=true; continue ;; esac
  CLEANED="$CLEANED$(printf '\037')$arg"
done

# Restore cleaned args into "$@".
OLDIFS="$IFS"; IFS="$(printf '\037')"
set -- $CLEANED
IFS="$OLDIFS"
# The leading empty element from the first \037 becomes $1=""; shift it.
[ -z "${1:-}" ] && shift

# Consume the subcommand word(s).
SUB1="${1:-}"; shift 2>/dev/null || true
SUB2=""
if [ "$SUB1" = "comment" ]; then
  SUB2="${1:-}"; shift 2>/dev/null || true
fi

if [ -n "$SUB2" ]; then
  exec hunk session "$SUB1" "$SUB2" "$SESSION_ID" "$@"
else
  exec hunk session "$SUB1" "$SESSION_ID" "$@"
fi
