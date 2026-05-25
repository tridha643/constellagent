import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { app, safeStorage } from 'electron'

const KEYCHAIN_FILE_NAME = 'mobile-bridge-identity.bin'
const PLAINTEXT_FALLBACK_FILE_NAME = 'mobile-bridge-identity.dev.json'

export interface MacIdentityKeyPair {
  readonly publicKeyBase64: string
  readonly privateKeyBase64: string
}

export interface LoadMacIdentityOptions {
  readonly storeDir?: string
  readonly allowPlaintextFallback?: boolean
}

interface PersistedIdentityFile {
  readonly version: 1
  readonly publicKeyBase64: string
  readonly privateKeyBase64: string
}

function resolveStoreDir(override?: string): string {
  if (override && override.trim()) return override
  const envOverride = process.env.CONSTELLAGENT_MOBILE_KEYCHAIN_DIR?.trim()
  if (envOverride) return envOverride
  return app.getPath('userData')
}

function resolveKeychainFile(storeDir: string): string {
  return join(storeDir, KEYCHAIN_FILE_NAME)
}

function resolveFallbackFile(storeDir: string): string {
  return join(storeDir, PLAINTEXT_FALLBACK_FILE_NAME)
}

function safeStorageAvailable(): boolean {
  try {
    return safeStorage?.isEncryptionAvailable?.() ?? false
  } catch {
    return false
  }
}

function generateNewIdentity(): PersistedIdentityFile {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicJwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const privateJwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string }
  return {
    version: 1,
    publicKeyBase64: base64UrlToBase64(publicJwk.x),
    privateKeyBase64: base64UrlToBase64(privateJwk.d),
  }
}

function readEncryptedIdentity(filePath: string): PersistedIdentityFile | null {
  if (!existsSync(filePath)) return null
  try {
    const buffer = readFileSync(filePath)
    const decrypted = safeStorage.decryptString(buffer)
    const parsed = JSON.parse(decrypted) as PersistedIdentityFile
    if (parsed?.version !== 1 || !parsed.publicKeyBase64 || !parsed.privateKeyBase64) return null
    return parsed
  } catch {
    return null
  }
}

function writeEncryptedIdentity(filePath: string, identity: PersistedIdentityFile): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const cipher = safeStorage.encryptString(JSON.stringify(identity))
  writeFileSync(filePath, cipher, { mode: 0o600 })
  try { chmodSync(filePath, 0o600) } catch {}
}

function readPlaintextFallback(filePath: string): PersistedIdentityFile | null {
  if (!existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PersistedIdentityFile
    if (parsed?.version !== 1 || !parsed.publicKeyBase64 || !parsed.privateKeyBase64) return null
    return parsed
  } catch {
    return null
  }
}

function writePlaintextFallback(filePath: string, identity: PersistedIdentityFile): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(identity, null, 2), { mode: 0o600 })
  try { chmodSync(filePath, 0o600) } catch {}
}

// Loads (or bootstraps) the Mac bridge identity. Private key is encrypted at rest
// via Electron safeStorage (macOS: Keychain Services); only the public key is
// exposed to callers who want to persist a pointer in SQLite.
export function loadOrCreateMacIdentity(options: LoadMacIdentityOptions = {}): MacIdentityKeyPair {
  const storeDir = resolveStoreDir(options.storeDir)
  const keychainFile = resolveKeychainFile(storeDir)
  const fallbackFile = resolveFallbackFile(storeDir)
  const encryptionAvailable = safeStorageAvailable()
  const allowFallback = options.allowPlaintextFallback ?? !app.isPackaged

  if (encryptionAvailable) {
    const existing = readEncryptedIdentity(keychainFile)
    if (existing) return toKeyPair(existing)
    const fresh = generateNewIdentity()
    writeEncryptedIdentity(keychainFile, fresh)
    return toKeyPair(fresh)
  }

  if (!allowFallback) {
    throw new Error(
      'Electron safeStorage encryption is unavailable; refusing to persist the mobile bridge identity in plaintext.',
    )
  }

  // Dev / CI fallback — never used on a packaged macOS build (safeStorage is
  // always available there). The fallback file is mode 0600 and explicitly
  // marked .dev.json so it cannot be confused with the encrypted artifact.
  const existing = readPlaintextFallback(fallbackFile)
  if (existing) return toKeyPair(existing)
  const fresh = generateNewIdentity()
  writePlaintextFallback(fallbackFile, fresh)
  return toKeyPair(fresh)
}

function toKeyPair(identity: PersistedIdentityFile): MacIdentityKeyPair {
  return {
    publicKeyBase64: identity.publicKeyBase64,
    privateKeyBase64: identity.privateKeyBase64,
  }
}

function base64UrlToBase64(value: string): string {
  if (!value) return ''
  const padded = `${value}${'='.repeat((4 - (value.length % 4 || 4)) % 4)}`
  return padded.replace(/-/g, '+').replace(/_/g, '/')
}

export const __testing = {
  KEYCHAIN_FILE_NAME,
  PLAINTEXT_FALLBACK_FILE_NAME,
  generateNewIdentity,
  resolveKeychainFile,
  resolveFallbackFile,
}
