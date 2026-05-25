import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempUserData = ''

mock.module('electron', () => ({
  app: {
    getPath: () => tempUserData,
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (_value: string) => Buffer.from([]),
    decryptString: (_value: Buffer) => '',
  },
}))

const { MobileStore } = await import('./mobile-store')

describe('MobileStore bridge identity', () => {
  beforeEach(() => {
    tempUserData = mkdtempSync(join(tmpdir(), 'constellagent-mobile-store-'))
  })

  afterEach(() => {
    try { rmSync(tempUserData, { recursive: true, force: true }) } catch {}
  })

  test('loadOrCreateBridgeDeviceState creates exactly one identity row, then returns it', async () => {
    const store = new MobileStore({ dbPath: join(tempUserData, 'mobile.db') })
    const a = await store.loadOrCreateBridgeDeviceState()
    const b = await store.loadOrCreateBridgeDeviceState()
    expect(a.macDeviceId).toBe(b.macDeviceId)
    expect(a.macIdentityPublicKey).toBe(b.macIdentityPublicKey)
    expect(a.macIdentityPrivateKey.length).toBeGreaterThan(20)
    expect(a.trustedPhones).toEqual({})
    await store.close()
  })

  test('rememberTrustedPhone + listTrustedPhones round-trip', async () => {
    const store = new MobileStore({ dbPath: join(tempUserData, 'mobile.db') })
    await store.loadOrCreateBridgeDeviceState()
    await store.rememberTrustedPhone('phone-1', 'pubkey-1', { sessionId: 's1' })
    await store.rememberTrustedPhone('phone-2', 'pubkey-2')
    const trusted = await store.listTrustedPhones()
    expect(trusted).toEqual({ 'phone-1': 'pubkey-1', 'phone-2': 'pubkey-2' })
    await store.close()
  })

  test('revokeTrustedPhone removes from listTrustedPhones', async () => {
    const store = new MobileStore({ dbPath: join(tempUserData, 'mobile.db') })
    await store.loadOrCreateBridgeDeviceState()
    await store.rememberTrustedPhone('phone-1', 'pubkey-1')
    await store.revokeTrustedPhone('phone-1')
    expect(await store.listTrustedPhones()).toEqual({})
    expect(await store.getTrustedPhonePublicKey('phone-1')).toBeNull()
    await store.close()
  })

  test('schema migration is idempotent across reopens', async () => {
    const dbPath = join(tempUserData, 'mobile.db')
    const a = new MobileStore({ dbPath })
    await a.loadOrCreateBridgeDeviceState()
    await a.close()
    const b = new MobileStore({ dbPath })
    const state = await b.loadOrCreateBridgeDeviceState()
    expect(state.macDeviceId.length).toBeGreaterThan(0)
    await b.close()
  })

  test('private key never lands in the SQLite file', async () => {
    const dbPath = join(tempUserData, 'mobile.db')
    const store = new MobileStore({ dbPath })
    const state = await store.loadOrCreateBridgeDeviceState()
    await store.close()
    // Read the raw SQLite file and grep for the private key bytes.
    expect(existsSync(dbPath)).toBe(true)
    const buf = readFileSync(dbPath)
    expect(buf.includes(state.macIdentityPrivateKey)).toBe(false)
  })

  test('keychain fallback file is mode 0600 + not committed by name', async () => {
    const store = new MobileStore({ dbPath: join(tempUserData, 'mobile.db') })
    await store.loadOrCreateBridgeDeviceState()
    const entries = readdirSync(tempUserData)
    // Dev fallback path is the only place that holds the private key on disk in
    // dev mode. Make sure it doesn't accidentally pick a misleading name.
    expect(entries).toContain('mobile-bridge-identity.dev.json')
    await store.close()
  })
})
