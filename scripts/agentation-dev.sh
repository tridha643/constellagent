# Sourceable helper: run a local agentation-mcp server alongside dev.
#
# The Agentation panel reads annotations from a local agentation-mcp HTTP/SSE
# server on :4747. The desktop app itself spawns NOTHING (D2: connect + status
# only) — this server is started here purely as dev convenience so the panel has
# a live stream while you work. Set CONSTELLAGENT_NO_AGENTATION=1 to skip it.
#
# Usage (from a dev script):
#   . "$(dirname "$0")/agentation-dev.sh"
#   start_agentation_dev
#   trap stop_agentation_dev EXIT INT TERM
#   ... run dev in the foreground (do NOT exec, or cleanup won't fire) ...

AGENTATION_DEV_PID=""

start_agentation_dev() {
  if [ "${CONSTELLAGENT_NO_AGENTATION:-}" = "1" ]; then
    echo "[dev] CONSTELLAGENT_NO_AGENTATION=1 — skipping agentation-mcp server"
    return 0
  fi
  _root="$(cd "$(dirname "$0")/.." && pwd)"
  _log="$_root/.agentation-dev.log"
  echo "[dev] starting agentation-mcp server (logs: $_log)"
  # --yes so npx auto-installs the package without an interactive prompt.
  npx --yes agentation-mcp server >"$_log" 2>&1 &
  AGENTATION_DEV_PID=$!
}

stop_agentation_dev() {
  if [ -n "$AGENTATION_DEV_PID" ] && kill -0 "$AGENTATION_DEV_PID" 2>/dev/null; then
    echo "[dev] stopping agentation-mcp server (pid $AGENTATION_DEV_PID)"
    kill "$AGENTATION_DEV_PID" 2>/dev/null || true
  fi
}
