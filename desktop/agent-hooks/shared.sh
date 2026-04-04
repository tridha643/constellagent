#!/bin/bash
# Shared helpers for Constellagent agent hooks
# Source this file from individual capture scripts

WS_ID="${AGENT_ORCH_WS_ID:-}"

# ---------- Snapshot-based checkpointing (no git objects) ----------
# Snapshots are JSON files in .constellagent/snapshots/ containing a git diff
# patch and base64-encoded untracked file contents. A capped manifest.json
# acts as a ring buffer (default 20 entries, oldest evicted).

SNAPSHOT_CAP="${CONSTELLAGENT_SNAPSHOT_CAP:-20}"

save_snapshot() {
  local dir="${1:-.}"
  local repo="$dir/.constellagent"
  local snap_dir="$repo/snapshots"
  mkdir -p "$snap_dir"

  local ts id snap_file
  ts=$(date +%s)
  id="${ts}-${RANDOM}"
  snap_file="$snap_dir/${id}.json"

  # Capture diff against HEAD (tracked changes)
  local diff_patch
  diff_patch=$(git -C "$dir" diff HEAD 2>/dev/null || echo "")

  # Capture untracked file list + contents (capped at 100 KB total)
  local untracked_json
  untracked_json=$(
    git -C "$dir" ls-files --others --exclude-standard 2>/dev/null \
      | head -50 \
      | while IFS= read -r f; do
          [ -z "$f" ] && continue
          local content
          content=$(head -c 102400 "$dir/$f" 2>/dev/null | base64)
          printf '%s\0%s\n' "$f" "$content"
        done \
      | jq -Rs 'split("\n") | map(select(length>0)) |
          map(split("\u0000") | {(.[0]): .[1]}) | add // {}'
  )

  # Write snapshot JSON
  local tmp
  tmp=$(mktemp "$snap_dir/.snap.XXXXXX.tmp") || return 1
  jq -n \
    --arg id "$id" \
    --arg ts "$ts" \
    --arg patch "$diff_patch" \
    --argjson untracked "${untracked_json:-{\}}" \
    '{id:$id, ts:$ts, patch:$patch, untracked:$untracked}' \
    > "$tmp" && mv "$tmp" "$snap_file" || { rm -f "$tmp"; return 1; }

  # Update capped manifest (ring buffer)
  local manifest="$snap_dir/manifest.json"
  local ids
  ids=$(jq -r '.ids // [] | .[]' "$manifest" 2>/dev/null || true)
  {
    echo "$ids"
    echo "$id"
  } | tail -n "$SNAPSHOT_CAP" \
    | jq -Rs 'split("\n") | map(select(length>0)) | {ids:.}' \
    > "${manifest}.tmp" && mv "${manifest}.tmp" "$manifest"

  # Evict snapshots no longer in manifest
  local kept
  kept=$(jq -r '.ids[]' "$manifest" 2>/dev/null || true)
  for old in "$snap_dir"/*.json; do
    [ "$old" = "$manifest" ] && continue
    local name
    name=$(basename "$old" .json)
    echo "$kept" | grep -qxF "$name" || rm -f "$old"
  done

  echo "$id"
}

get_head_fast() {
  git -C "${1:-.}" rev-parse HEAD 2>/dev/null || echo ""
}

write_pending() {
  local cwd="$1" agent="$2" sid="$3" tool="$4" input="$5" file="$6" ts="$7"
  local head_override="${8:-}"
  local repo="$cwd/.constellagent"
  [ ! -d "$repo" ] && return 0
  local pending_dir="$repo/.pending"
  mkdir -p "$pending_dir"
  local head
  if [ -n "$head_override" ]; then
    head="$head_override"
  elif [ "$CHECKPOINT_MODE" = "full" ]; then
    head=$(save_snapshot "$cwd")
  else
    head=$(get_head_fast "$cwd")
  fi
  # Default empty input to null so the JSON stays valid
  [ -z "$input" ] && input="null"
  local tmp out
  tmp=$(mktemp "${pending_dir}/.pending.XXXXXX.tmp") || return 0
  out="$pending_dir/$(date +%s)-$RANDOM.json"
  if jq -n \
    --arg ws "$WS_ID" \
    --arg agent "$agent" \
    --arg sid "$sid" \
    --arg tool "$tool" \
    --arg file "${file:-}" \
    --arg ts "$ts" \
    --arg head "$head" \
    --argjson input "$input" \
    '{ws:$ws, agent:$agent, sid:$sid, tool:$tool, input:$input, file:$file, ts:$ts, head:$head}' \
    > "$tmp"
  then
    mv "$tmp" "$out" || rm -f "$tmp"
  else
    rm -f "$tmp"
  fi
}

write_pending_full() {
  local cwd="$1" agent="$2" sid="$3" tool="$4" input="$5" file="$6" ts="$7" event_type="$8" tool_response="$9"
  local head_override="${10:-}"
  local repo="$cwd/.constellagent"
  [ ! -d "$repo" ] && return 0
  local pending_dir="$repo/.pending"
  mkdir -p "$pending_dir"
  local head
  if [ -n "$head_override" ]; then
    head="$head_override"
  elif [ "$CHECKPOINT_MODE" = "full" ]; then
    head=$(save_snapshot "$cwd")
  else
    head=$(get_head_fast "$cwd")
  fi
  # Default empty input/response to null so the JSON stays valid
  [ -z "$input" ] && input="null"
  [ -z "$tool_response" ] && tool_response="null"
  local tmp out
  tmp=$(mktemp "${pending_dir}/.pending.XXXXXX.tmp") || return 0
  out="$pending_dir/$(date +%s)-$RANDOM.json"
  if jq -n \
    --arg ws "$WS_ID" \
    --arg agent "$agent" \
    --arg sid "$sid" \
    --arg tool "$tool" \
    --arg file "${file:-}" \
    --arg ts "$ts" \
    --arg head "$head" \
    --arg event_type "${event_type:-}" \
    --argjson input "$input" \
    --argjson tool_response "$tool_response" \
    '{ws:$ws, agent:$agent, sid:$sid, tool:$tool, input:$input, file:$file, ts:$ts, head:$head, event_type:$event_type, tool_response:$tool_response}' \
    > "$tmp"
  then
    mv "$tmp" "$out" || rm -f "$tmp"
  else
    rm -f "$tmp"
  fi
}

# Read the best available sliding window context for the current workspace.
# Prefers per-workspace file, falls back to global, then activity.md.
# Usage: CONTEXT=$(read_sliding_window "$CWD")
read_sliding_window() {
  local cwd="$1"
  local repo="$cwd/.constellagent"
  local ws_file="$repo/context/sliding-window-${WS_ID}.md"
  local global_file="$repo/context/sliding-window.md"
  local activity_file="$repo/context/activity.md"

  if [ -n "$WS_ID" ] && [ -f "$ws_file" ]; then
    head -c 4000 "$ws_file"
  elif [ -f "$global_file" ]; then
    head -c 4000 "$global_file"
  elif [ -f "$activity_file" ]; then
    tail -30 "$activity_file"
  fi
}

# Read the rich agent context generated from the AgentFS database.
# Prefers per-workspace agent-context, falls back to global, then sliding window.
# Usage: CONTEXT=$(read_agent_context "$CWD")
read_agent_context() {
  local cwd="$1"
  local repo="$cwd/.constellagent"
  local ws_ctx="$repo/context/agent-context-${WS_ID}.md"
  local global_ctx="$repo/context/agent-context.md"

  if [ -n "$WS_ID" ] && [ -f "$ws_ctx" ]; then
    head -c 6000 "$ws_ctx"
  elif [ -f "$global_ctx" ]; then
    head -c 6000 "$global_ctx"
  else
    # Fall back to sliding window
    read_sliding_window "$cwd"
  fi
}
