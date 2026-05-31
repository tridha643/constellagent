#!/usr/bin/env sh
# Build IslandNotch (macOS notch companion) and launch it for local desktop dev.
# Invoked from root `bun run dev`. Skip with CONSTELLAGENT_SKIP_ISLAND_NOTCH=1.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS="$ROOT/macos"
DERIVED_DATA="${CONSTELLAGENT_ISLAND_NOTCH_DERIVED_DATA:-$MACOS/.build/DerivedData}"
APP="$DERIVED_DATA/Build/Products/Debug/IslandNotch.app"
ENTITLEMENTS="$MACOS/BuildSupport/IslandNotch.entitlements"
BUNDLE_ID="com.constellagent.islandnotch"

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

SIGNING_IDENTITY=""
SIGNING_KEYCHAIN=""
if SIGNING_INFO="$(sh "$ROOT/scripts/ensure-island-notch-signing.sh" 2>/dev/null)"; then
  SIGNING_IDENTITY="$(printf '%s' "$SIGNING_INFO" | sed -n '1p')"
  SIGNING_KEYCHAIN="$(printf '%s' "$SIGNING_INFO" | sed -n '2p')"
fi

echo "[island-notch] building Debug → $APP"
if [ -n "$SIGNING_IDENTITY" ]; then
  echo "[island-notch] stable dev signing enabled ($SIGNING_IDENTITY)"
fi

# xcodebuild still uses PrivateOverrides DEVELOPMENT_TEAM when set; we re-sign below
# whenever the output would otherwise be ad-hoc.
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

# Always re-sign when a stable dev cert exists — xcodebuild can leave ad-hoc Mach-O
# files inside a previously signed .app bundle (Team ID mismatch → instant crash on launch).
if [ -n "$SIGNING_IDENTITY" ]; then
  echo "[island-notch] re-signing with stable dev certificate (TCC grants survive rebuilds)"
  sh "$ROOT/scripts/sign-island-notch-app.sh" "$APP" "$SIGNING_IDENTITY" "$ENTITLEMENTS" "$SIGNING_KEYCHAIN"
elif codesign -dvv "$APP" 2>&1 | grep -q "Signature=adhoc"; then
  echo "[island-notch] ⚠️  ad-hoc signed — Accessibility & Screen Recording grants" >&2
  echo "[island-notch] ⚠️  will reset on every rebuild (double-⌘ + captures break)." >&2
  echo "[island-notch] ⚠️  Fix: cp macos/BuildSupport/PrivateOverrides.xcconfig.example \\" >&2
  echo "[island-notch] ⚠️       macos/BuildSupport/PrivateOverrides.xcconfig and set DEVELOPMENT_TEAM," >&2
  echo "[island-notch] ⚠️  or ensure openssl/security can create the local dev cert." >&2
fi

if codesign -dvv "$APP" 2>&1 | grep -q "Signature=adhoc"; then
  :
else
  AUTHORITY="$(codesign -dvv "$APP" 2>&1 | grep '^Authority=' | head -1 | cut -d= -f2- || true)"
  if [ -n "$AUTHORITY" ]; then
    echo "[island-notch] signed: $AUTHORITY"
  fi
  echo "[island-notch] TCC grants persist across rebuilds for this signing identity."
  echo "[island-notch] If permissions still look enabled but do not work, reset stale grants once:"
  echo "[island-notch]   tccutil reset Accessibility $BUNDLE_ID"
  echo "[island-notch]   tccutil reset ScreenCapture $BUNDLE_ID"
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

# Dev launch: treat Constellagent as present for the shelf badge while desktop dev runs.
CONSTELLAGENT_ISLAND_NOTCH_ALWAYS=1 open "$APP"
echo "[island-notch] launched"
