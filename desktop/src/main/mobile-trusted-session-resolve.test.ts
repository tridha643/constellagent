import { describe, expect, test, beforeEach } from 'bun:test'
import {
  __resetTrustedSessionResolveNonceCacheForTests,
  generateTrustedSessionResolveTestKeys,
  resolveTrustedSession,
  signTrustedSessionResolveRequestForTests,
} from './mobile-trusted-session-resolve'

describe('mobile trusted session resolve', () => {
  beforeEach(() => {
    __resetTrustedSessionResolveNonceCacheForTests()
  })

  test('returns a fresh session id for a trusted phone with a valid signature', () => {
    const phone = generateTrustedSessionResolveTestKeys()
    const nowMs = Date.now()
    const request = {
      macDeviceId: 'mac-123',
      phoneDeviceId: phone.phoneDeviceId,
      phoneIdentityPublicKey: phone.phoneIdentityPublicKey,
      nonce: 'nonce-abc',
      timestamp: nowMs,
      signature: signTrustedSessionResolveRequestForTests({
        macDeviceId: 'mac-123',
        phoneDeviceId: phone.phoneDeviceId,
        phoneIdentityPublicKey: phone.phoneIdentityPublicKey,
        phoneIdentityPrivateKey: phone.phoneIdentityPrivateKey,
        nonce: 'nonce-abc',
        timestamp: nowMs,
      }),
    }

    const result = resolveTrustedSession({
      request,
      bridgeMacDeviceId: 'mac-123',
      bridgeMacIdentityPublicKey: 'mac-public-key',
      bridgeDisplayName: 'Tri Mac',
      trustedPhonePublicKey: phone.phoneIdentityPublicKey,
      bridgeRunning: true,
      nowMs,
      randomSessionId: () => 'fresh-session-id',
    })

    expect(result).toEqual({
      ok: true,
      macDeviceId: 'mac-123',
      macIdentityPublicKey: 'mac-public-key',
      displayName: 'Tri Mac',
      sessionId: 'fresh-session-id',
    })
  })

  test('rejects unknown phones', () => {
    const phone = generateTrustedSessionResolveTestKeys()
    const nowMs = Date.now()
    const result = resolveTrustedSession({
      request: {
        macDeviceId: 'mac-123',
        phoneDeviceId: phone.phoneDeviceId,
        phoneIdentityPublicKey: phone.phoneIdentityPublicKey,
        nonce: 'nonce-abc',
        timestamp: nowMs,
        signature: signTrustedSessionResolveRequestForTests({
          macDeviceId: 'mac-123',
          phoneDeviceId: phone.phoneDeviceId,
          phoneIdentityPublicKey: phone.phoneIdentityPublicKey,
          phoneIdentityPrivateKey: phone.phoneIdentityPrivateKey,
          nonce: 'nonce-abc',
          timestamp: nowMs,
        }),
      },
      bridgeMacDeviceId: 'mac-123',
      bridgeMacIdentityPublicKey: 'mac-public-key',
      bridgeDisplayName: 'Tri Mac',
      trustedPhonePublicKey: null,
      bridgeRunning: true,
      nowMs,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('phone_not_trusted')
    }
  })

  test('rejects replayed nonces', () => {
    const phone = generateTrustedSessionResolveTestKeys()
    const nowMs = Date.now()
    const request = {
      macDeviceId: 'mac-123',
      phoneDeviceId: phone.phoneDeviceId,
      phoneIdentityPublicKey: phone.phoneIdentityPublicKey,
      nonce: 'nonce-replay',
      timestamp: nowMs,
      signature: signTrustedSessionResolveRequestForTests({
        macDeviceId: 'mac-123',
        phoneDeviceId: phone.phoneDeviceId,
        phoneIdentityPublicKey: phone.phoneIdentityPublicKey,
        phoneIdentityPrivateKey: phone.phoneIdentityPrivateKey,
        nonce: 'nonce-replay',
        timestamp: nowMs,
      }),
    }

    const input = {
      request,
      bridgeMacDeviceId: 'mac-123',
      bridgeMacIdentityPublicKey: 'mac-public-key',
      bridgeDisplayName: 'Tri Mac',
      trustedPhonePublicKey: phone.phoneIdentityPublicKey,
      bridgeRunning: true,
      nowMs,
    }

    expect(resolveTrustedSession(input).ok).toBe(true)
    const replay = resolveTrustedSession(input)
    expect(replay.ok).toBe(false)
    if (!replay.ok) {
      expect(replay.code).toBe('resolve_request_replayed')
    }
  })
})
