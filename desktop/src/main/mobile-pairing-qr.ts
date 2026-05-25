import { randomBytes } from 'node:crypto'
import {
  PAIRING_QR_VERSION,
  pairingQrPayloadSchema,
  type PairingQrPayload,
} from '@constellagent/mobile-protocol'

export const SHORT_PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const SHORT_PAIRING_CODE_LENGTH = 10

export const MAX_PAIRING_AGE_MS = 5 * 60 * 1000

export interface BuildPairingPayloadInput {
  readonly relayUrl: string
  readonly sessionId: string
  readonly macDeviceId: string
  readonly macIdentityPublicKey: string
  readonly displayName?: string
  readonly nowMs?: number
}

// Build the JSON the phone scans from the desktop's QR. Encryption material
// stays separate — this payload is just enough to start the secure handshake.
export function buildPairingPayload(input: BuildPairingPayloadInput): PairingQrPayload {
  const now = input.nowMs ?? Date.now()
  return pairingQrPayloadSchema.parse({
    v: PAIRING_QR_VERSION,
    relay: input.relayUrl,
    sessionId: input.sessionId,
    macDeviceId: input.macDeviceId,
    macIdentityPublicKey: input.macIdentityPublicKey,
    expiresAt: now + MAX_PAIRING_AGE_MS,
    displayName: input.displayName?.trim() ?? '',
  })
}

export interface CreateShortPairingCodeOptions {
  readonly length?: number
  readonly randomBytesImpl?: (size: number) => Buffer
}

export function createShortPairingCode(options: CreateShortPairingCodeOptions = {}): string {
  const length = Number.isInteger(options.length) && (options.length ?? 0) > 0
    ? (options.length as number)
    : SHORT_PAIRING_CODE_LENGTH
  const bytes = (options.randomBytesImpl ?? randomBytes)(length)
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += SHORT_PAIRING_CODE_ALPHABET[bytes[i]! % SHORT_PAIRING_CODE_ALPHABET.length]
  }
  return code
}

export function serializePairingPayload(payload: PairingQrPayload): string {
  return JSON.stringify(payload)
}
