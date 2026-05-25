// Port of phodex-bridge/src/secure-transport.js (Remodex) for constellagent.
// Owns the bridge-side E2EE handshake, envelope crypto, and reconnect catch-up
// buffer that mediates every iPhone ↔ desktop frame.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto'
import {
  HANDSHAKE_TAG,
  PAIRING_QR_VERSION,
  SECURE_PROTOCOL_VERSION,
  clientAuthSchema,
  clientHelloSchema,
  encryptedEnvelopeSchema,
  resumeStateSchema,
  type EncryptedEnvelope,
  type SecureError,
} from '@constellagent/mobile-protocol'

export type SendWireMessage = (rawMessage: string) => boolean | void

export interface BridgeSecureTransportDeviceState {
  readonly macDeviceId: string
  readonly macIdentityPublicKey: string
  readonly macIdentityPrivateKey: string
  readonly trustedPhones: Readonly<Record<string, string>>
}

export interface CreateBridgeSecureTransportOptions {
  readonly sessionId: string
  readonly relayUrl: string
  readonly deviceState: BridgeSecureTransportDeviceState
  readonly displayName?: string
  readonly persistTrustedPhone?: boolean
  readonly nowMs?: () => number
  readonly onTrustedPhoneUpdate?: (info: {
    phoneDeviceId: string
    phoneIdentityPublicKey: string
  }) => void
}

export interface HandleIncomingHandlers {
  readonly sendControlMessage: (message: ControlMessage) => void
  readonly onApplicationMessage: (payloadText: string) => void
}

type ControlMessage = SecureError | Record<string, unknown>

const HANDSHAKE_MODE_QR_BOOTSTRAP = 'qr_bootstrap'
const HANDSHAKE_MODE_TRUSTED_RECONNECT = 'trusted_reconnect'
const SECURE_SENDER_MAC = 'mac'
const SECURE_SENDER_IPHONE = 'iphone'
const MAX_PAIRING_AGE_MS = 5 * 60 * 1000
const MAX_BRIDGE_OUTBOUND_MESSAGES = 500
const MAX_BRIDGE_OUTBOUND_BYTES = 10 * 1024 * 1024

interface PendingHandshake {
  sessionId: string
  handshakeMode: 'qr_bootstrap' | 'trusted_reconnect'
  keyEpoch: number
  phoneDeviceId: string
  phoneIdentityPublicKey: string
  phoneEphemeralPublicKey: string
  macEphemeralPrivateKey: string
  macEphemeralPublicKey: string
  transcriptBytes: Buffer
  expiresAtForTranscript: number
}

interface ActiveSession {
  sessionId: string
  keyEpoch: number
  phoneDeviceId: string
  phoneIdentityPublicKey: string
  phoneToMacKey: Buffer
  macToPhoneKey: Buffer
  lastInboundCounter: number
  nextOutboundCounter: number
  isResumed: boolean
  sendWireMessage: SendWireMessage | null
  firstOutboundSeq: number
}

interface OutboundBufferEntry {
  bridgeOutboundSeq: number
  payloadText: string
  sizeBytes: number
}

export interface BridgeSecureTransport {
  readonly PAIRING_QR_VERSION: typeof PAIRING_QR_VERSION
  readonly SECURE_PROTOCOL_VERSION: typeof SECURE_PROTOCOL_VERSION
  bindLiveSendWireMessage(send: SendWireMessage | null): void
  /** Returns the pairing payload bytes expected by the QR encoder. Refreshes expiry. */
  createPairingPayload(): {
    v: typeof PAIRING_QR_VERSION
    relay: string
    sessionId: string
    macDeviceId: string
    macIdentityPublicKey: string
    expiresAt: number
    displayName: string
  }
  /** Returns `true` when the frame was recognised + handled (even if it produced a secureError). */
  handleIncomingWireMessage(rawMessage: string, handlers: HandleIncomingHandlers): boolean
  isSecureChannelReady(): boolean
  /** Application-layer plaintext from the desktop to the phone; encrypts + buffers + sends. */
  queueOutboundApplicationMessage(payloadText: string, sendWireMessage?: SendWireMessage): void
  /** Snapshot — for tests. */
  __inspect(): {
    pendingHandshake: PendingHandshake | null
    activeSession: ActiveSession | null
    outboundBufferLength: number
    lastRelayedBridgeOutboundSeq: number
    nextBridgeOutboundSeq: number
    currentPairingExpiresAt: number
  }
}

export function createBridgeSecureTransport(
  options: CreateBridgeSecureTransportOptions,
): BridgeSecureTransport {
  const {
    sessionId,
    relayUrl,
    displayName = '',
    persistTrustedPhone: _persistTrustedPhone = true,
    nowMs = () => Date.now(),
    onTrustedPhoneUpdate,
  } = options
  let currentDeviceState: BridgeSecureTransportDeviceState = {
    ...options.deviceState,
    trustedPhones: { ...options.deviceState.trustedPhones },
  }
  const bridgeDisplayName = normalizeNonEmptyString(displayName)

  let pendingHandshake: PendingHandshake | null = null
  let activeSession: ActiveSession | null = null
  let liveSendWireMessage: SendWireMessage | null = null
  let lastRelayedBridgeOutboundSeq = 0
  let currentPairingExpiresAt = nowMs() + MAX_PAIRING_AGE_MS
  let nextKeyEpoch = 1
  let nextBridgeOutboundSeq = 1
  let outboundBufferBytes = 0
  const outboundBuffer: OutboundBufferEntry[] = []

  function createPairingPayload() {
    currentPairingExpiresAt = nowMs() + MAX_PAIRING_AGE_MS
    return {
      v: PAIRING_QR_VERSION,
      relay: relayUrl,
      sessionId,
      macDeviceId: currentDeviceState.macDeviceId,
      macIdentityPublicKey: currentDeviceState.macIdentityPublicKey,
      expiresAt: currentPairingExpiresAt,
      displayName: bridgeDisplayName,
    }
  }

  function handleIncomingWireMessage(
    rawMessage: string,
    { sendControlMessage, onApplicationMessage }: HandleIncomingHandlers,
  ): boolean {
    const parsed = safeParseJson(rawMessage)
    if (!parsed || typeof parsed !== 'object') return false
    const obj = parsed as Record<string, unknown>
    const kind = normalizeNonEmptyString(obj.kind as string | undefined)
    if (!kind) {
      if ('method' in obj || obj.id != null) {
        sendControlMessage(createSecureError({
          code: 'update_required',
          message: 'This bridge requires the latest constellagent iPhone app for secure pairing.',
        }))
        return true
      }
      return false
    }

    switch (kind) {
      case 'clientHello':
        handleClientHello(obj, sendControlMessage)
        return true
      case 'clientAuth':
        handleClientAuth(obj, sendControlMessage)
        return true
      case 'resumeState':
        handleResumeState(obj)
        return true
      case 'encryptedEnvelope':
        return handleEncryptedEnvelope(obj, sendControlMessage, onApplicationMessage)
      default:
        return false
    }
  }

  function handleClientHello(
    message: Record<string, unknown>,
    sendControlMessage: (m: ControlMessage) => void,
  ): void {
    const parsed = clientHelloSchema.safeParse(message)
    if (!parsed.success) {
      sendControlMessage(createSecureError({
        code: 'invalid_client_hello',
        message: 'The iPhone handshake is missing required secure fields.',
      }))
      return
    }
    const {
      protocolVersion,
      sessionId: incomingSessionId,
      handshakeMode,
      phoneDeviceId,
      phoneIdentityPublicKey,
      phoneEphemeralPublicKey,
      clientNonce: clientNonceBase64,
    } = parsed.data

    if (protocolVersion !== SECURE_PROTOCOL_VERSION || incomingSessionId !== sessionId) {
      sendControlMessage(createSecureError({
        code: 'update_required',
        message: 'The bridge and iPhone are not using the same secure transport version.',
      }))
      return
    }

    if (handshakeMode === HANDSHAKE_MODE_QR_BOOTSTRAP && nowMs() > currentPairingExpiresAt) {
      sendControlMessage(createSecureError({
        code: 'pairing_expired',
        message: 'The pairing QR code has expired. Generate a new QR code from the bridge.',
      }))
      return
    }

    const trustedPhonePublicKey = getTrustedPhonePublicKey(phoneDeviceId)
    if (handshakeMode === HANDSHAKE_MODE_TRUSTED_RECONNECT) {
      if (!trustedPhonePublicKey) {
        sendControlMessage(createSecureError({
          code: 'phone_not_trusted',
          message: 'This iPhone is not trusted by the current bridge. Scan a fresh QR code to pair again.',
        }))
        return
      }
      if (trustedPhonePublicKey !== phoneIdentityPublicKey) {
        sendControlMessage(createSecureError({
          code: 'phone_identity_changed',
          message: 'The trusted iPhone identity does not match this reconnect attempt.',
        }))
        return
      }
    }

    const clientNonce = base64ToBuffer(clientNonceBase64)
    if (clientNonce.length === 0) {
      sendControlMessage(createSecureError({
        code: 'invalid_client_nonce',
        message: 'The iPhone secure nonce could not be decoded.',
      }))
      return
    }

    const ephemeral = generateKeyPairSync('x25519')
    const privateJwk = ephemeral.privateKey.export({ format: 'jwk' }) as { d: string; x: string }
    const publicJwk = ephemeral.publicKey.export({ format: 'jwk' }) as { x: string }
    const serverNonce = randomBytes(32)
    const keyEpoch = nextKeyEpoch
    const expiresAtForTranscript = handshakeMode === HANDSHAKE_MODE_QR_BOOTSTRAP
      ? currentPairingExpiresAt
      : 0

    const transcriptBytes = buildTranscriptBytes({
      sessionId,
      protocolVersion,
      handshakeMode,
      keyEpoch,
      macDeviceId: currentDeviceState.macDeviceId,
      phoneDeviceId,
      macIdentityPublicKey: currentDeviceState.macIdentityPublicKey,
      phoneIdentityPublicKey,
      macEphemeralPublicKey: base64UrlToBase64(publicJwk.x),
      phoneEphemeralPublicKey,
      clientNonce,
      serverNonce,
      expiresAtForTranscript,
    })
    const macSignature = signTranscript(
      currentDeviceState.macIdentityPrivateKey,
      currentDeviceState.macIdentityPublicKey,
      transcriptBytes,
    )

    pendingHandshake = {
      sessionId,
      handshakeMode,
      keyEpoch,
      phoneDeviceId,
      phoneIdentityPublicKey,
      phoneEphemeralPublicKey,
      macEphemeralPrivateKey: base64UrlToBase64(privateJwk.d),
      macEphemeralPublicKey: base64UrlToBase64(publicJwk.x),
      transcriptBytes,
      expiresAtForTranscript,
    }
    activeSession = null

    sendControlMessage({
      kind: 'serverHello',
      protocolVersion: SECURE_PROTOCOL_VERSION,
      sessionId,
      handshakeMode,
      macDeviceId: currentDeviceState.macDeviceId,
      macIdentityPublicKey: currentDeviceState.macIdentityPublicKey,
      macEphemeralPublicKey: pendingHandshake.macEphemeralPublicKey,
      serverNonce: serverNonce.toString('base64'),
      keyEpoch,
      expiresAtForTranscript,
      macSignature,
      clientNonce: clientNonceBase64,
      displayName: bridgeDisplayName,
    })
  }

  function handleClientAuth(
    message: Record<string, unknown>,
    sendControlMessage: (m: ControlMessage) => void,
  ): void {
    if (!pendingHandshake) {
      sendControlMessage(createSecureError({
        code: 'unexpected_client_auth',
        message: 'The bridge did not have a pending secure handshake to finalize.',
      }))
      return
    }
    const parsed = clientAuthSchema.safeParse(message)
    if (!parsed.success) {
      pendingHandshake = null
      sendControlMessage(createSecureError({
        code: 'invalid_client_auth',
        message: 'The secure client authentication payload was invalid.',
      }))
      return
    }
    const { sessionId: incomingSessionId, phoneDeviceId, keyEpoch, phoneSignature } = parsed.data
    if (
      incomingSessionId !== pendingHandshake.sessionId
      || phoneDeviceId !== pendingHandshake.phoneDeviceId
      || keyEpoch !== pendingHandshake.keyEpoch
    ) {
      pendingHandshake = null
      sendControlMessage(createSecureError({
        code: 'invalid_client_auth',
        message: 'The secure client authentication payload was invalid.',
      }))
      return
    }

    const clientAuthTranscript = Buffer.concat([
      pendingHandshake.transcriptBytes,
      encodeLengthPrefixedUtf8('client-auth'),
    ])
    const phoneVerified = verifyTranscript(
      pendingHandshake.phoneIdentityPublicKey,
      clientAuthTranscript,
      phoneSignature,
    )
    if (!phoneVerified) {
      pendingHandshake = null
      sendControlMessage(createSecureError({
        code: 'invalid_phone_signature',
        message: 'The iPhone secure signature could not be verified.',
      }))
      return
    }

    const sharedSecret = diffieHellman({
      privateKey: createPrivateKey({
        key: {
          crv: 'X25519',
          d: base64ToBase64Url(pendingHandshake.macEphemeralPrivateKey),
          kty: 'OKP',
          x: base64ToBase64Url(pendingHandshake.macEphemeralPublicKey),
        },
        format: 'jwk',
      }),
      publicKey: createPublicKey({
        key: {
          crv: 'X25519',
          kty: 'OKP',
          x: base64ToBase64Url(pendingHandshake.phoneEphemeralPublicKey),
        },
        format: 'jwk',
      }),
    })
    const salt = createHash('sha256').update(pendingHandshake.transcriptBytes).digest()
    const infoPrefix = [
      HANDSHAKE_TAG,
      pendingHandshake.sessionId,
      currentDeviceState.macDeviceId,
      pendingHandshake.phoneDeviceId,
      String(pendingHandshake.keyEpoch),
    ].join('|')

    activeSession = {
      sessionId: pendingHandshake.sessionId,
      keyEpoch: pendingHandshake.keyEpoch,
      phoneDeviceId: pendingHandshake.phoneDeviceId,
      phoneIdentityPublicKey: pendingHandshake.phoneIdentityPublicKey,
      phoneToMacKey: deriveAesKey(sharedSecret, salt, `${infoPrefix}|phoneToMac`),
      macToPhoneKey: deriveAesKey(sharedSecret, salt, `${infoPrefix}|macToPhone`),
      lastInboundCounter: -1,
      nextOutboundCounter: 0,
      isResumed: false,
      sendWireMessage: liveSendWireMessage,
      firstOutboundSeq: nextBridgeOutboundSeq,
    }

    nextKeyEpoch = pendingHandshake.keyEpoch + 1
    const shouldRemember = pendingHandshake.handshakeMode === HANDSHAKE_MODE_QR_BOOTSTRAP
      || getTrustedPhonePublicKey(pendingHandshake.phoneDeviceId) !== null
    if (shouldRemember) {
      const previousTrustedPhonePublicKey = getTrustedPhonePublicKey(pendingHandshake.phoneDeviceId)
      currentDeviceState = withTrustedPhone(
        currentDeviceState,
        pendingHandshake.phoneDeviceId,
        pendingHandshake.phoneIdentityPublicKey,
      )
      if (
        previousTrustedPhonePublicKey !== pendingHandshake.phoneIdentityPublicKey
        || pendingHandshake.handshakeMode === HANDSHAKE_MODE_QR_BOOTSTRAP
      ) {
        onTrustedPhoneUpdate?.({
          phoneDeviceId: pendingHandshake.phoneDeviceId,
          phoneIdentityPublicKey: pendingHandshake.phoneIdentityPublicKey,
        })
      }
    }
    if (pendingHandshake.handshakeMode === HANDSHAKE_MODE_QR_BOOTSTRAP) {
      resetOutboundReplayState()
      activeSession.firstOutboundSeq = nextBridgeOutboundSeq
    }

    pendingHandshake = null
    sendControlMessage({
      kind: 'secureReady',
      sessionId,
      keyEpoch: activeSession.keyEpoch,
      macDeviceId: currentDeviceState.macDeviceId,
    })
  }

  function handleResumeState(message: Record<string, unknown>): void {
    if (!activeSession) return
    const parsed = resumeStateSchema.safeParse(message)
    if (!parsed.success) return
    const { sessionId: incomingSessionId, keyEpoch, lastAppliedBridgeOutboundSeq } = parsed.data
    if (incomingSessionId !== sessionId || keyEpoch !== activeSession.keyEpoch) return
    lastRelayedBridgeOutboundSeq = lastAppliedBridgeOutboundSeq
    const missingEntries = replayableOutboundEntries(lastAppliedBridgeOutboundSeq, {
      includeCurrentSessionEntries: true,
    })
    activeSession.isResumed = true
    for (const entry of missingEntries) {
      if (!sendBufferedEntry(entry, activeSession.sendWireMessage)) break
    }
  }

  function handleEncryptedEnvelope(
    message: Record<string, unknown>,
    sendControlMessage: (m: ControlMessage) => void,
    onApplicationMessage: (payloadText: string) => void,
  ): boolean {
    if (!activeSession) {
      sendControlMessage(createSecureError({
        code: 'secure_channel_unavailable',
        message: 'The secure channel is not ready yet on the bridge.',
      }))
      return true
    }

    const parsed = encryptedEnvelopeSchema.safeParse(message)
    if (!parsed.success) {
      sendControlMessage(createSecureError({
        code: 'invalid_envelope',
        message: 'The bridge rejected an invalid secure envelope.',
      }))
      return true
    }
    const envelope = parsed.data
    if (
      envelope.sessionId !== sessionId
      || envelope.keyEpoch !== activeSession.keyEpoch
      || envelope.sender !== SECURE_SENDER_IPHONE
      || envelope.counter <= activeSession.lastInboundCounter
    ) {
      sendControlMessage(createSecureError({
        code: 'invalid_envelope',
        message: 'The bridge rejected an invalid or replayed secure envelope.',
      }))
      return true
    }

    const plaintextBuffer = decryptEnvelopeBuffer(
      envelope,
      activeSession.phoneToMacKey,
      SECURE_SENDER_IPHONE,
      envelope.counter,
    )
    if (!plaintextBuffer) {
      sendControlMessage(createSecureError({
        code: 'decrypt_failed',
        message: 'The bridge could not decrypt the iPhone secure payload.',
      }))
      return true
    }
    activeSession.lastInboundCounter = envelope.counter
    const payloadObject = safeParseJson(plaintextBuffer.toString('utf8')) as
      | { payloadText?: unknown }
      | null
    const payloadText = normalizeNonEmptyString(payloadObject?.payloadText as string | undefined)
    if (!payloadText) {
      sendControlMessage(createSecureError({
        code: 'invalid_payload',
        message: 'The secure payload did not contain a usable application message.',
      }))
      return true
    }
    onApplicationMessage(payloadText)
    return true
  }

  function queueOutboundApplicationMessage(
    payloadText: string,
    sendWireMessage?: SendWireMessage,
  ): void {
    const normalized = normalizeNonEmptyString(payloadText)
    if (!normalized) return
    const entry: OutboundBufferEntry = {
      bridgeOutboundSeq: nextBridgeOutboundSeq,
      payloadText: normalized,
      sizeBytes: Buffer.byteLength(normalized, 'utf8'),
    }
    nextBridgeOutboundSeq += 1
    outboundBuffer.push(entry)
    outboundBufferBytes += entry.sizeBytes
    trimOutboundBuffer()

    const liveSender = activeSession?.sendWireMessage ?? sendWireMessage ?? null
    if (activeSession?.isResumed && liveSender) {
      sendBufferedEntry(entry, liveSender)
    }
  }

  function isSecureChannelReady(): boolean {
    return Boolean(activeSession?.isResumed)
  }

  function bindLiveSendWireMessage(send: SendWireMessage | null): void {
    liveSendWireMessage = send
    if (activeSession) {
      activeSession.sendWireMessage = send
      replayBufferedOutboundMessages()
    }
  }

  function trimOutboundBuffer(): void {
    let removeCount = 0
    let removedBytes = 0
    while (
      outboundBuffer.length - removeCount > MAX_BRIDGE_OUTBOUND_MESSAGES
      || outboundBufferBytes - removedBytes > MAX_BRIDGE_OUTBOUND_BYTES
    ) {
      const entry = outboundBuffer[removeCount]
      if (!entry) break
      removedBytes += entry.sizeBytes
      removeCount += 1
    }
    if (removeCount > 0) {
      outboundBuffer.splice(0, removeCount)
      outboundBufferBytes = Math.max(0, outboundBufferBytes - removedBytes)
    }
  }

  function resetOutboundReplayState(): void {
    outboundBuffer.length = 0
    outboundBufferBytes = 0
    lastRelayedBridgeOutboundSeq = 0
    nextBridgeOutboundSeq = 1
  }

  function sendBufferedEntry(
    entry: OutboundBufferEntry,
    sendWireMessage: SendWireMessage | null,
  ): boolean {
    if (!activeSession?.isResumed || !sendWireMessage) return false
    const envelope = encryptEnvelopePayload(
      {
        bridgeOutboundSeq: entry.bridgeOutboundSeq,
        payloadText: entry.payloadText,
      },
      activeSession.macToPhoneKey,
      SECURE_SENDER_MAC,
      activeSession.nextOutboundCounter,
      sessionId,
      activeSession.keyEpoch,
    )
    activeSession.nextOutboundCounter += 1
    return sendWireMessage(JSON.stringify(envelope)) !== false
  }

  function replayableOutboundEntries(
    lastAppliedBridgeOutboundSeq: number,
    { includeCurrentSessionEntries = false } = {},
  ): OutboundBufferEntry[] {
    return outboundBuffer.filter((entry) => {
      if (entry.bridgeOutboundSeq > lastAppliedBridgeOutboundSeq) return true
      return (
        includeCurrentSessionEntries
        && activeSession !== null
        && entry.bridgeOutboundSeq >= activeSession.firstOutboundSeq
      )
    })
  }

  function replayBufferedOutboundMessages(): void {
    if (!activeSession?.isResumed || !activeSession.sendWireMessage) return
    for (const entry of replayableOutboundEntries(lastRelayedBridgeOutboundSeq)) {
      if (!sendBufferedEntry(entry, activeSession.sendWireMessage)) break
    }
  }

  function getTrustedPhonePublicKey(phoneDeviceId: string): string | null {
    const trimmed = normalizeNonEmptyString(phoneDeviceId)
    if (!trimmed) return null
    return currentDeviceState.trustedPhones[trimmed] ?? null
  }

  return {
    PAIRING_QR_VERSION,
    SECURE_PROTOCOL_VERSION,
    bindLiveSendWireMessage,
    createPairingPayload,
    handleIncomingWireMessage,
    isSecureChannelReady,
    queueOutboundApplicationMessage,
    __inspect: () => ({
      pendingHandshake,
      activeSession,
      outboundBufferLength: outboundBuffer.length,
      lastRelayedBridgeOutboundSeq,
      nextBridgeOutboundSeq,
      currentPairingExpiresAt,
    }),
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported subset is consumed by tests).
// ---------------------------------------------------------------------------

export function nonceForDirection(sender: 'mac' | 'iphone', counter: number): Buffer {
  const nonce = Buffer.alloc(12, 0)
  nonce.writeUInt8(sender === SECURE_SENDER_MAC ? 1 : 2, 0)
  let value = BigInt(counter)
  for (let index = 11; index >= 1; index -= 1) {
    nonce[index] = Number(value & 0xffn)
    value >>= 8n
  }
  return nonce
}

function encryptEnvelopePayload(
  payloadObject: Record<string, unknown>,
  key: Buffer,
  sender: 'mac' | 'iphone',
  counter: number,
  sessionId: string,
  keyEpoch: number,
): EncryptedEnvelope {
  const nonce = nonceForDirection(sender, counter)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payloadObject), 'utf8')),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return {
    kind: 'encryptedEnvelope',
    v: SECURE_PROTOCOL_VERSION,
    sessionId,
    keyEpoch,
    sender,
    counter,
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  }
}

function decryptEnvelopeBuffer(
  envelope: EncryptedEnvelope,
  key: Buffer,
  sender: 'mac' | 'iphone',
  counter: number,
): Buffer | null {
  try {
    const nonce = nonceForDirection(sender, counter)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(base64ToBuffer(envelope.tag))
    return Buffer.concat([
      decipher.update(base64ToBuffer(envelope.ciphertext)),
      decipher.final(),
    ])
  } catch {
    return null
  }
}

function deriveAesKey(sharedSecret: Buffer, salt: Buffer, infoLabel: string): Buffer {
  return Buffer.from(hkdfSync('sha256', sharedSecret, salt, Buffer.from(infoLabel, 'utf8'), 32))
}

function signTranscript(
  privateKeyBase64: string,
  publicKeyBase64: string,
  transcriptBytes: Buffer,
): string {
  const signature = sign(
    null,
    transcriptBytes,
    createPrivateKey({
      key: {
        crv: 'Ed25519',
        d: base64ToBase64Url(privateKeyBase64),
        kty: 'OKP',
        x: base64ToBase64Url(publicKeyBase64),
      },
      format: 'jwk',
    }),
  )
  return signature.toString('base64')
}

function verifyTranscript(
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

interface BuildTranscriptInput {
  sessionId: string
  protocolVersion: number
  handshakeMode: string
  keyEpoch: number
  macDeviceId: string
  phoneDeviceId: string
  macIdentityPublicKey: string
  phoneIdentityPublicKey: string
  macEphemeralPublicKey: string
  phoneEphemeralPublicKey: string
  clientNonce: Buffer
  serverNonce: Buffer
  expiresAtForTranscript: number
}

function buildTranscriptBytes(input: BuildTranscriptInput): Buffer {
  return Buffer.concat([
    encodeLengthPrefixedUtf8(HANDSHAKE_TAG),
    encodeLengthPrefixedUtf8(input.sessionId),
    encodeLengthPrefixedUtf8(String(input.protocolVersion)),
    encodeLengthPrefixedUtf8(input.handshakeMode),
    encodeLengthPrefixedUtf8(String(input.keyEpoch)),
    encodeLengthPrefixedUtf8(input.macDeviceId),
    encodeLengthPrefixedUtf8(input.phoneDeviceId),
    encodeLengthPrefixedBuffer(base64ToBuffer(input.macIdentityPublicKey)),
    encodeLengthPrefixedBuffer(base64ToBuffer(input.phoneIdentityPublicKey)),
    encodeLengthPrefixedBuffer(base64ToBuffer(input.macEphemeralPublicKey)),
    encodeLengthPrefixedBuffer(base64ToBuffer(input.phoneEphemeralPublicKey)),
    encodeLengthPrefixedBuffer(input.clientNonce),
    encodeLengthPrefixedBuffer(input.serverNonce),
    encodeLengthPrefixedUtf8(String(input.expiresAtForTranscript)),
  ])
}

function encodeLengthPrefixedUtf8(value: string): Buffer {
  return encodeLengthPrefixedBuffer(Buffer.from(String(value), 'utf8'))
}

function encodeLengthPrefixedBuffer(buffer: Buffer): Buffer {
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(buffer.length, 0)
  return Buffer.concat([length, buffer])
}

function withTrustedPhone(
  state: BridgeSecureTransportDeviceState,
  phoneDeviceId: string,
  phoneIdentityPublicKey: string,
): BridgeSecureTransportDeviceState {
  return {
    ...state,
    trustedPhones: { ...state.trustedPhones, [phoneDeviceId]: phoneIdentityPublicKey },
  }
}

function createSecureError({ code, message }: { code: string; message: string }): SecureError {
  return { kind: 'secureError', code, message }
}

function normalizeNonEmptyString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function safeParseJson(value: string): unknown {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function base64ToBuffer(value: string): Buffer {
  try {
    return Buffer.from(value, 'base64')
  } catch {
    return Buffer.alloc(0)
  }
}

function base64UrlToBase64(value: string): string {
  const padded = `${value}${'='.repeat((4 - (value.length % 4 || 4)) % 4)}`
  return padded.replace(/-/g, '+').replace(/_/g, '/')
}

function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

// Test-only helpers — exported so the iPhone-side handshake can be driven from
// a unit test without re-implementing every primitive twice.
export const __testing = {
  HANDSHAKE_MODE_QR_BOOTSTRAP,
  HANDSHAKE_MODE_TRUSTED_RECONNECT,
  SECURE_SENDER_MAC,
  SECURE_SENDER_IPHONE,
  MAX_BRIDGE_OUTBOUND_MESSAGES,
  MAX_BRIDGE_OUTBOUND_BYTES,
  buildTranscriptBytes,
  encodeLengthPrefixedUtf8,
  encryptEnvelopePayload,
  decryptEnvelopeBuffer,
  deriveAesKey,
  signTranscript,
  verifyTranscript,
  base64ToBase64Url,
  base64UrlToBase64,
}
