import type { PairingQrPayload } from '@constellagent/mobile-protocol'
import { createShortPairingCode } from './mobile-pairing-qr'

export type PairingCodeResolveErrorCode = 'pairing_code_expired' | 'pairing_code_unavailable'

export interface PairingCodeResolveSuccess {
  readonly ok: true
  readonly v: number
  readonly sessionId: string
  readonly macDeviceId: string
  readonly macIdentityPublicKey: string
  readonly expiresAt: number
  readonly displayName: string
}

export interface PairingCodeResolveFailure {
  readonly ok: false
  readonly code: PairingCodeResolveErrorCode
  readonly error: string
}

export type PairingCodeResolveResult = PairingCodeResolveSuccess | PairingCodeResolveFailure

export interface ActivePairingCode {
  readonly code: string
  readonly payload: PairingQrPayload
  readonly expiresAtMs: number
}

export function normalizePairingCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[-\s]/g, '')
}

export class MobilePairingCodeRegistry {
  private active: ActivePairingCode | null = null

  register(payload: PairingQrPayload, code = createShortPairingCode()): ActivePairingCode {
    const normalizedCode = normalizePairingCode(code)
    const entry: ActivePairingCode = {
      code: normalizedCode,
      payload,
      expiresAtMs: payload.expiresAt,
    }
    this.active = entry
    return entry
  }

  getActive(): ActivePairingCode | null {
    this.purgeExpired()
    return this.active
  }

  getActivePayloadForSessionId(sessionId: string): PairingQrPayload | null {
    const active = this.getActive()
    if (!active || active.payload.sessionId !== sessionId.trim()) {
      return null
    }
    return active.payload
  }

  resolve(rawCode: string, nowMs = Date.now()): PairingCodeResolveResult {
    const code = normalizePairingCode(rawCode)
    if (!code) {
      return {
        ok: false,
        code: 'pairing_code_unavailable',
        error: 'Enter a valid pairing code.',
      }
    }

    const active = this.active
    if (!active || active.code !== code) {
      this.purgeExpired(nowMs)
      return {
        ok: false,
        code: 'pairing_code_unavailable',
        error: 'That pairing code is not available right now.',
      }
    }

    if (active.expiresAtMs <= nowMs) {
      this.active = null
      return {
        ok: false,
        code: 'pairing_code_expired',
        error: 'This pairing code has expired.',
      }
    }

    const { payload } = active
    return {
      ok: true,
      v: payload.v,
      sessionId: payload.sessionId,
      macDeviceId: payload.macDeviceId,
      macIdentityPublicKey: payload.macIdentityPublicKey,
      expiresAt: payload.expiresAt,
      displayName: payload.displayName ?? '',
    }
  }

  purgeExpired(nowMs = Date.now()): void {
    if (this.active && this.active.expiresAtMs <= nowMs) {
      this.active = null
    }
  }
}
