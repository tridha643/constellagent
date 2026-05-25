import { describe, expect, test } from 'bun:test'
import { PAIRING_QR_VERSION } from '@constellagent/mobile-protocol'
import { buildPairingPayload } from './mobile-pairing-qr'
import { MobilePairingCodeRegistry, normalizePairingCode } from './mobile-pairing-code-registry'

describe('mobile pairing code registry', () => {
  test('normalizes dashed short codes', () => {
    expect(normalizePairingCode('ab23-cd34ef')).toBe('AB23CD34EF')
  })

  test('resolves the active pairing code into a payload', () => {
    const registry = new MobilePairingCodeRegistry()
    const payload = buildPairingPayload({
      relayUrl: 'ws://192.168.2.66:3987/ws',
      sessionId: 'session-123',
      macDeviceId: 'mac-123',
      macIdentityPublicKey: 'pub-key',
      displayName: 'Constellagent',
      nowMs: 1_800_000_000_000,
    })
    const active = registry.register(payload, 'AB23CD34EF')

    expect(registry.resolve('ab23-cd34ef', 1_800_000_000_000)).toEqual({
      ok: true,
      v: PAIRING_QR_VERSION,
      sessionId: 'session-123',
      macDeviceId: 'mac-123',
      macIdentityPublicKey: 'pub-key',
      expiresAt: active.expiresAtMs,
      displayName: 'Constellagent',
    })
  })

  test('returns unavailable for unknown codes', () => {
    const registry = new MobilePairingCodeRegistry()
    expect(registry.resolve('ZZZZZZZZZZ')).toEqual({
      ok: false,
      code: 'pairing_code_unavailable',
      error: 'That pairing code is not available right now.',
    })
  })

  test('returns expired after the payload TTL', () => {
    const registry = new MobilePairingCodeRegistry()
    const payload = buildPairingPayload({
      relayUrl: 'ws://127.0.0.1:3987/ws',
      sessionId: 'session-123',
      macDeviceId: 'mac-123',
      macIdentityPublicKey: 'pub-key',
      nowMs: 1_800_000_000_000,
    })
    registry.register(payload, 'AB23CD34EF')

    expect(registry.resolve('AB23CD34EF', payload.expiresAt + 1)).toEqual({
      ok: false,
      code: 'pairing_code_expired',
      error: 'This pairing code has expired.',
    })
  })
})
