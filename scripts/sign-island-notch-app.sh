#!/usr/bin/env sh
# Re-sign IslandNotch.app with a stable identity (inside-out) so TCC grants persist.
set -e

APP="$1"
CERT_HASH="$2"
ENTITLEMENTS="$3"
KEYCHAIN="${4:-}"

if [ -z "$APP" ] || [ -z "$CERT_HASH" ] || [ -z "$ENTITLEMENTS" ]; then
  echo "usage: sign-island-notch-app.sh <IslandNotch.app> <cert-sha1> <entitlements.plist> [keychain]" >&2
  exit 1
fi

if [ ! -d "$APP" ]; then
  echo "sign-island-notch-app: app not found: $APP" >&2
  exit 1
fi

KEYCHAIN_ARGS=""
if [ -n "$KEYCHAIN" ]; then
  KEYCHAIN_PASS="${ISLAND_NOTCH_KEYCHAIN_PASS:-islandnotch}"
  security unlock-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN" >/dev/null 2>&1 || true
  KEYCHAIN_ARGS="--keychain $KEYCHAIN"
fi

sign() {
  # shellcheck disable=SC2086
  codesign --force --options runtime --timestamp=none --sign "$CERT_HASH" $KEYCHAIN_ARGS "$@"
}

if [ -d "$APP/Contents/Frameworks" ]; then
  find "$APP/Contents/Frameworks" -depth \( -name '*.dylib' -o -name '*.framework' \) -print0 2>/dev/null \
    | while IFS= read -r -d '' item; do
        sign "$item"
      done
fi

if [ -d "$APP/Contents/Resources" ]; then
  find "$APP/Contents/Resources" -depth -name '*.bundle' -print0 2>/dev/null \
    | while IFS= read -r -d '' bundle; do
        if [ -d "$bundle/Contents/MacOS" ]; then
          sign "$bundle"
        fi
      done
fi

for dylib in "$APP/Contents/MacOS/"*.dylib; do
  [ -f "$dylib" ] || continue
  sign "$dylib"
done

# Entitlements attach to the main executable only; the bundle gets a sealing signature.
sign --entitlements "$ENTITLEMENTS" "$APP/Contents/MacOS/IslandNotch"
sign "$APP"

codesign --verify --deep --strict "$APP" 2>&1
