#!/usr/bin/env sh
# Ensures IslandNotch can be signed with a stable identity so macOS TCC grants
# (Accessibility, Screen Recording) survive rebuilds. Ad-hoc builds get a new
# cdhash every compile and permissions silently stop working.
#
# Writes two lines to stdout:
#   line 1: codesign identity (certificate common name)
#   line 2: keychain path
#
# Falls back silently (exit 1) when openssl/security are unavailable.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS="$ROOT/macos"
SIGNING_DIR="$MACOS/.build/signing"
KEYCHAIN="$SIGNING_DIR/islandnotch-dev.keychain-db"
KEYCHAIN_PASS="${ISLAND_NOTCH_KEYCHAIN_PASS:-islandnotch}"
CERT_CN="Constellagent IslandNotch Dev"

if ! command -v openssl >/dev/null 2>&1 || ! command -v security >/dev/null 2>&1; then
  exit 1
fi

mkdir -p "$SIGNING_DIR"

generate_local_certificates() {
  if [ ! -f "$SIGNING_DIR/islandnotch-dev.key" ]; then
    openssl genrsa -out "$SIGNING_DIR/islandnotch-dev.key" 2048 2>/dev/null
  fi

  if [ ! -f "$SIGNING_DIR/islandnotch-dev.crt" ]; then
    cat > "$SIGNING_DIR/islandnotch-dev.cnf" <<'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3

[dn]
CN = Constellagent IslandNotch Dev
O = Constellagent Local Development

[v3]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF
    openssl req -new -x509 \
      -key "$SIGNING_DIR/islandnotch-dev.key" \
      -out "$SIGNING_DIR/islandnotch-dev.crt" \
      -days 825 \
      -config "$SIGNING_DIR/islandnotch-dev.cnf" \
      -extensions v3 2>/dev/null
  fi
}

ensure_keychain() {
  generate_local_certificates

  if [ ! -f "$KEYCHAIN" ] && [ ! -f "$KEYCHAIN-db" ]; then
    security create-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN" >/dev/null 2>&1
  fi

  security unlock-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN" >/dev/null 2>&1 || true
  security set-keychain-settings -lut 21600 "$KEYCHAIN" >/dev/null 2>&1 || true

  # Import cert + private key as PKCS#12 — `security import … -f openssl` fails on
  # modern macOS with PKCS#8 keys ("Unknown format in import").
  P12="$SIGNING_DIR/islandnotch-dev.p12"
  if [ ! -f "$P12" ] \
    || [ "$SIGNING_DIR/islandnotch-dev.crt" -nt "$P12" ] \
    || [ "$SIGNING_DIR/islandnotch-dev.key" -nt "$P12" ]; then
    # -legacy: OpenSSL 3.x otherwise emits PKCS12 MACs `security import` rejects.
    openssl pkcs12 -export -legacy \
      -out "$P12" \
      -inkey "$SIGNING_DIR/islandnotch-dev.key" \
      -in "$SIGNING_DIR/islandnotch-dev.crt" \
      -passout pass:"$KEYCHAIN_PASS" 2>/dev/null
  fi
  security import "$P12" -k "$KEYCHAIN" -P "$KEYCHAIN_PASS" \
    -A -T /usr/bin/codesign -T /usr/bin/security >/dev/null 2>&1 || true

  # Prepend our keychain so codesign finds the identity first.
  # shellcheck disable=SC2046
  security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"') >/dev/null 2>&1 || true
}

verify_identity() {
  TMP="$(mktemp)"
  cp /bin/ls "$TMP"
  codesign --force --sign "$CERT_CN" --keychain "$KEYCHAIN" --timestamp=none "$TMP" >/dev/null 2>&1
  rc=$?
  rm -f "$TMP"
  return "$rc"
}

ensure_keychain
if ! verify_identity; then
  exit 1
fi

printf '%s\n' "$CERT_CN"
printf '%s\n' "$KEYCHAIN"
