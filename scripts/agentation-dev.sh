# Sourceable helper: legacy external agentation-mcp server for dev.
#
# constellagent now embeds the Agentation HTTP server in the Electron main process.
# This script is kept as a no-op unless CONSTELLAGENT_EXTERNAL_AGENTATION=1.

AGENTATION_DEV_PID=""

start_agentation_dev() {
  if [ "${CONSTELLAGENT_NO_AGENTATION:-}" = "1" ]; then
    echo "[dev] CONSTELLAGENT_NO_AGENTATION=1 — skipping external agentation server"
    return 0
  fi
  if [ "${CONSTELLAGENT_EXTERNAL_AGENTATION:-}" != "1" ]; then
    echo "[dev] using embedded Agentation HTTP server (set CONSTELLAGENT_EXTERNAL_AGENTATION=1 for npx fallback)"
    return 0
  fi
  _root="$(cd "$(dirname "$0")/.." && pwd)"
  _log="$_root/.agentation-dev.log"
  echo "[dev] starting external agentation-mcp server (logs: $_log)"
  npx --yes agentation-mcp server >"$_log" 2>&1 &
  AGENTATION_DEV_PID=$!
}

stop_agentation_dev() {
  if [ -n "$AGENTATION_DEV_PID" ] && kill -0 "$AGENTATION_DEV_PID" 2>/dev/null; then
    echo "[dev] stopping external agentation-mcp server (pid $AGENTATION_DEV_PID)"
    kill "$AGENTATION_DEV_PID" 2>/dev/null || true
  fi
}
