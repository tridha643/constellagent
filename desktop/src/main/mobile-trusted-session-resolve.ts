import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto'

export const TRUSTED_SESSION_RESOLVE_TAG = 'constellagent-trusted-session-resolve-v1'
export const TRUSTED_SESSION_RESOLVE_CLOCK_SKEW_MS = 90_000
const NONCE_TTL_MS = 5 * 60_000

export interface TrustedSessionResolveRequest {
  readonly macDeviceId: string
  readonly phoneDeviceId: string
  readonly phoneIdentityPublicKey: string
  readonly nonce: string
  readonly timestamp: number
  readonly signature: string
}

export interface TrustedSessionResolveSuccess {
  readonly ok: true
  readonly macDeviceId: string
  readonly macIdentityPublicKey: string
  readonly displayName: string
  readonly sessionId: string
}

export interface TrustedSessionResolveFailure {
  readonly ok: false
  readonly code:
    | 'phone_not_trusted'
    | 'invalid_signature'
    | 'session_unavailable'
    | 'resolve_request_expired'
    | 'resolve_request_replayed'
  readonly error: string
}

export type TrustedSessionResolveResult = TrustedSessionResolveSuccess | TrustedSessionResolveFailure

export interface ResolveTrustedSessionInput {
  readonly request: TrustedSessionResolveRequest
  readonly bridgeMacDeviceId: string
  readonly bridgeMacIdentityPublicKey: string
  readonly bridgeDisplayName: string
  readonly trustedPhonePublicKey: string | null
  readonly bridgeRunning: boolean
  readonly nowMs?: number
  readonly randomSessionId?: () => string
}

export function buildTrustedSessionResolveTranscriptBytes(input: {
  macDeviceId: string
  phoneDeviceId: string
  phoneIdentityPublicKey: string
  nonce: string
  timestamp: number
}): Buffer {
  return Buffer.concat([
    encodeLengthPrefixedUtf8(TRUSTED_SESSION_RESOLVE_TAG),
    encodeLengthPrefixedUtf8(input.macDeviceId),
    encodeLengthPrefixedUtf8(input.phoneDeviceId),
    encodeLengthPrefixedBuffer(base64ToBuffer(input.phoneIdentityPublicKey)),
    encodeLengthPrefixedUtf8(input.nonce),
    encodeLengthPrefixedUtf8(String(input.timestamp)),
  ])
}

export function resolveTrustedSession(input: ResolveTrustedSessionInput): TrustedSessionResolveResult {
  const nowMs = input.nowMs ?? Date.now()
  const {
    request,
    bridgeMacDeviceId,
    bridgeMacIdentityPublicKey,
    bridgeDisplayName,
    trustedPhonePublicKey,
    bridgeRunning,
  } = input

  if (!bridgeRunning) {
    return {
      ok: false,
      code: 'session_unavailable',
      error: 'The desktop bridge is not running right now.',
    }
  }

  const macDeviceId = request.macDeviceId.trim()
  const phoneDeviceId = request.phoneDeviceId.trim()
  const phoneIdentityPublicKey = request.phoneIdentityPublicKey.trim()
  const nonce = request.nonce.trim()
  const signature = request.signature.trim()
  const timestamp = request.timestamp

  if (!macDeviceId || !phoneDeviceId || !phoneIdentityPublicKey || !nonce || !signature) {
    return {
      ok: false,
      code: 'invalid_signature',
      error: 'The trusted reconnect request is missing required fields.',
    }
  }

  if (macDeviceId !== bridgeMacDeviceId) {
    return {
      ok: false,
      code: 'phone_not_trusted',
      error: 'This iPhone is not trusted by the current bridge.',
    }
  }

  if (!trustedPhonePublicKey || trustedPhonePublicKey !== phoneIdentityPublicKey) {
    return {
      ok: false,
      code: 'phone_not_trusted',
      error: 'This iPhone is not trusted by the current bridge.',
    }
  }

  if (!Number.isFinite(timestamp)) {
    return {
      ok: false,
      code: 'resolve_request_expired',
      error: 'The trusted reconnect request has an invalid timestamp.',
    }
  }

  const ageMs = Math.abs(nowMs - timestamp)
  if (ageMs > TRUSTED_SESSION_RESOLVE_CLOCK_SKEW_MS) {
    return {
      ok: false,
      code: 'resolve_request_expired',
      error: 'The trusted reconnect request expired. Try reconnecting again.',
    }
  }

  if (trustedSessionResolveNonceCache.has(nonce, nowMs)) {
    return {
      ok: false,
      code: 'resolve_request_replayed',
      error: 'The trusted reconnect request was already used.',
    }
  }

  const transcriptBytes = buildTrustedSessionResolveTranscriptBytes({
    macDeviceId,
    phoneDeviceId,
    phoneIdentityPublicKey,
    nonce,
    timestamp,
  })

  if (!verifyTrustedSessionResolveSignature(phoneIdentityPublicKey, transcriptBytes, signature)) {
    return {
      ok: false,
      code: 'invalid_signature',
      error: 'The trusted reconnect signature could not be verified.',
    }
  }

  trustedSessionResolveNonceCache.remember(nonce, nowMs)

  return {
    ok: true,
    macDeviceId: bridgeMacDeviceId,
    macIdentityPublicKey: bridgeMacIdentityPublicKey,
    displayName: bridgeDisplayName,
    sessionId: (input.randomSessionId ?? randomUUID)(),
  }
}

function verifyTrustedSessionResolveSignature(
  publicKeyBase64: string,
  transcriptBytes: Buffer,
  signatureBase64: string,
): boolean {
  try {
    return verify(
      null,
      transcriptBytes,
      createPublicKey({
        key: {
          crv: 'Ed25519',
          kty: 'OKP',
          x: base64ToBase64Url(publicKeyBase64),
        },
        format: 'jwk',
      }),
      base64ToBuffer(signatureBase64),
    )
  } catch {
    return false
  }
}

class TrustedSessionResolveNonceCache {
  private readonly entries = new Map<string, number>()

  has(nonce: string, nowMs: number): boolean {
    this.purge(nowMs)
    return this.entries.has(nonce)
  }

  remember(nonce: string, nowMs: number): void {
    this.purge(nowMs)
    this.entries.set(nonce, nowMs + NONCE_TTL_MS)
  }

  private purge(nowMs: number): void {
    for (const [nonce, expiresAtMs] of this.entries) {
      if (expiresAtMs <= nowMs) {
        this.entries.delete(nonce)
      }
    }
  }
}

const trustedSessionResolveNonceCache = new TrustedSessionResolveNonceCache()

export function __resetTrustedSessionResolveNonceCacheForTests(): void {
  trustedSessionResolveNonceCache['entries'].clear()
}

function encodeLengthPrefixedUtf8(value: string): Buffer {
  return encodeLengthPrefixedBuffer(Buffer.from(String(value), 'utf8'))
}

function encodeLengthPrefixedBuffer(buffer: Buffer): Buffer {
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(buffer.length, 0)
  return Buffer.concat([length, buffer])
}

function base64ToBuffer(value: string): Buffer {
  try {
    return Buffer.from(value, 'base64')
  } catch {
    return Buffer.alloc(0)
  }
}

function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** Test helper: signs a trusted-session resolve request like the iPhone would. */
export function signTrustedSessionResolveRequestForTests(input: {
  macDeviceId: string
  phoneDeviceId: string
  phoneIdentityPublicKey: string
  phoneIdentityPrivateKey: string
  nonce: string
  timestamp: number
}): string {
  const transcriptBytes = buildTrustedSessionResolveTranscriptBytes(input)
  const signature = sign(
    null,
    transcriptBytes,
    createPrivateKey({
      key: {
        crv: 'Ed25519',
        d: base64ToBase64Url(input.phoneIdentityPrivateKey),
        kty: 'OKP',
        x: base64ToBase64Url(input.phoneIdentityPublicKey),
      },
      format: 'jwk',
    }),
  )
  return signature.toString('base64')
}

/** Generates an Ed25519 key pair for trusted-session resolve tests. */
export function generateTrustedSessionResolveTestKeys(): {
  phoneDeviceId: string
  phoneIdentityPublicKey: string
  phoneIdentityPrivateKey: string
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { d: string }
  return {
    phoneDeviceId: randomUUID(),
    phoneIdentityPublicKey: Buffer.from(pubJwk.x, 'base64url').toString('base64'),
    phoneIdentityPrivateKey: Buffer.from(privJwk.d, 'base64url').toString('base64'),
  }
}
