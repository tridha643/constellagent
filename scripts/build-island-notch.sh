#!/usr/bin/env sh
# Build IslandNotch (macOS notch companion) and launch it for local desktop dev.
# Invoked from root `bun run dev`. Skip with CONSTELLAGENT_SKIP_ISLAND_NOTCH=1.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS="$ROOT/macos"
DERIVED_DATA="${CONSTELLAGENT_ISLAND_NOTCH_DERIVED_DATA:-$MACOS/.build/DerivedData}"
APP="$DERIVED_DATA/Build/Products/Debug/IslandNotch.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[island-notch] skip (not macOS)"
  exit 0
fi

if [ "${CONSTELLAGENT_SKIP_ISLAND_NOTCH:-}" = "1" ]; then
  echo "[island-notch] skip (CONSTELLAGENT_SKIP_ISLAND_NOTCH=1)"
  exit 0
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "[island-notch] skip (xcodebuild not found — install Xcode)"
  exit 0
fi

mkdir -p "$MACOS/.build"

echo "[island-notch] building Debug → $APP"
xcodebuild \
  -project "$MACOS/IslandNotch.xcodeproj" \
  -scheme IslandNotch \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED_DATA" \
  -quiet \
  build

if [ ! -d "$APP" ]; then
  echo "[island-notch] build succeeded but app bundle missing: $APP" >&2
  exit 1
fi

# An ad-hoc signature (no DEVELOPMENT_TEAM) gets a fresh cdhash on every build,
# so macOS TCC silently drops the app's Accessibility + Screen Recording grants
# each rebuild — the double-⌘ tap stops firing and captures go blank even though
# System Settings still looks enabled. Warn loudly and point at the fix.
if codesign -dvv "$APP" 2>&1 | grep -q "Signature=adhoc"; then
  echo "[island-notch] ⚠️  ad-hoc signed — Accessibility & Screen Recording grants" >&2
  echo "[island-notch] ⚠️  will reset on every rebuild (double-⌘ + captures break)." >&2
  echo "[island-notch] ⚠️  Fix: cp macos/BuildSupport/PrivateOverrides.xcconfig.example \\" >&2
  echo "[island-notch] ⚠️       macos/BuildSupport/PrivateOverrides.xcconfig and set DEVELOPMENT_TEAM." >&2
fi

if [ "${CONSTELLAGENT_ISLAND_NOTCH_NO_LAUNCH:-}" = "1" ]; then
  echo "[island-notch] built (launch skipped: CONSTELLAGENT_ISLAND_NOTCH_NO_LAUNCH=1)"
  exit 0
fi

# Relaunch so code changes from the last build are picked up.
if pgrep -x IslandNotch >/dev/null 2>&1; then
  osascript -e 'quit app "IslandNotch"' >/dev/null 2>&1 || true
  sleep 0.3
fi

open "$APP"
echo "[island-notch] launched"
