import { describe, expect, test } from 'bun:test'
import { buildMobileRelayWsUrl, parseWebSocketUpgradePath } from './mobile-ws-path'

describe('mobile websocket paths', () => {
  test('accepts bare /ws for health probes', () => {
    expect(parseWebSocketUpgradePath('/ws')).toEqual({ accepted: true })
  })

  test('accepts /ws/<sessionId> used by iPhone QR pairing URLs', () => {
    const sessionId = '8bcfb248-50e1-4a1d-b45d-be1ce6ce5870'
    expect(parseWebSocketUpgradePath(`/ws/${sessionId}`)).toEqual({
      accepted: true,
      pairingSessionId: sessionId,
    })
  })

  test('rejects unrelated paths', () => {
    expect(parseWebSocketUpgradePath('/health')).toEqual({ accepted: false })
    expect(parseWebSocketUpgradePath('/ws/')).toEqual({ accepted: false })
    expect(parseWebSocketUpgradePath('/ws/a/b')).toEqual({ accepted: false })
  })

  test('builds relay base URL for pairing payloads', () => {
    expect(buildMobileRelayWsUrl('192.168.2.66', 3987)).toBe('ws://192.168.2.66:3987/ws')
  })
})
