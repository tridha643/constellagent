import { describe, expect, test } from 'bun:test'
import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto'
import {
  createBridgeSecureTransport,
  nonceForDirection,
  __testing,
  type BridgeSecureTransportDeviceState,
} from './mobile-secure-transport'
import {
  HANDSHAKE_TAG,
  SECURE_PROTOCOL_VERSION,
  type EncryptedEnvelope,
} from '@constellagent/mobile-protocol'

const HANDSHAKE_MODE_QR_BOOTSTRAP = __testing.HANDSHAKE_MODE_QR_BOOTSTRAP as 'qr_bootstrap'
const HANDSHAKE_MODE_TRUSTED_RECONNECT = __testing.HANDSHAKE_MODE_TRUSTED_RECONNECT as 'trusted_reconnect'
const SECURE_SENDER_IPHONE = __testing.SECURE_SENDER_IPHONE as 'iphone'
const {
  buildTranscriptBytes,
  encodeLengthPrefixedUtf8,
  deriveAesKey,
  base64ToBase64Url,
  base64UrlToBase64,
} = __testing

function b64UrlToB64(value: string): string {
  return base64UrlToBase64(value)
}

function makeMacDeviceState(): BridgeSecureTransportDeviceState {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string }
  return {
    macDeviceId: 'mac-device-' + Math.random().toString(36).slice(2),
    macIdentityPublicKey: b64UrlToB64(pubJwk.x),
    macIdentityPrivateKey: b64UrlToB64(privJwk.d),
    trustedPhones: {},
  }
}

function makePhoneIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string }
  return {
    phoneDeviceId: 'phone-device-' + Math.random().toString(36).slice(2),
    publicKeyBase64: b64UrlToB64(pubJwk.x),
    privateKeyBase64: b64UrlToB64(privJwk.d),
  }
}

function makePhoneEphemeral() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string }
  return {
    publicKeyBase64: b64UrlToB64(pubJwk.x),
    privateKeyBase64: b64UrlToB64(privJwk.d),
  }
}

function signTranscriptWithPhone(
  privateKeyBase64: string,
  publicKeyBase64: string,
  transcript: Buffer,
): string {
  return sign(
    null,
    transcript,
    createPrivateKey({
      key: {
        crv: 'Ed25519',
        d: base64ToBase64Url(privateKeyBase64),
        kty: 'OKP',
        x: base64ToBase64Url(publicKeyBase64),
      },
      format: 'jwk',
    }),
  ).toString('base64')
}

interface DrivePairingResult {
  clientNonce: Buffer
  serverHello: any
  phoneToMacKey: Buffer
  macToPhoneKey: Buffer
  inboundCounter: number
}

function drivePairing(opts: {
  transport: ReturnType<typeof createBridgeSecureTransport>
  sessionId: string
  macDeviceId: string
  macIdentityPublicKey: string
  phone: ReturnType<typeof makePhoneIdentity>
  handshakeMode: 'qr_bootstrap' | 'trusted_reconnect'
}): DrivePairingResult & { secureReady: any } {
  const { transport, sessionId, macDeviceId, macIdentityPublicKey, phone, handshakeMode } = opts
  const phoneEphemeral = makePhoneEphemeral()
  const clientNonce = randomBytes(32)
  const sent: any[] = []
  const send = (m: any) => sent.push(m)

  // clientHello
  transport.handleIncomingWireMessage(
    JSON.stringify({
      kind: 'clientHello',
      protocolVersion: SECURE_PROTOCOL_VERSION,
      sessionId,
      handshakeMode,
      phoneDeviceId: phone.phoneDeviceId,
      phoneIdentityPublicKey: phone.publicKeyBase64,
      phoneEphemeralPublicKey: phoneEphemeral.publicKeyBase64,
      clientNonce: clientNonce.toString('base64'),
    }),
    { sendControlMessage: send, onApplicationMessage: () => {} },
  )
  const serverHello = sent.find((m) => m?.kind === 'serverHello')
  if (!serverHello) throw new Error('serverHello not produced — sent: ' + JSON.stringify(sent))

  // Reconstruct the transcript bytes to derive the same keys + sign as the phone.
  const transcript = buildTranscriptBytes({
    sessionId,
    protocolVersion: SECURE_PROTOCOL_VERSION,
    handshakeMode,
    keyEpoch: serverHello.keyEpoch,
    macDeviceId,
    phoneDeviceId: phone.phoneDeviceId,
    macIdentityPublicKey,
    phoneIdentityPublicKey: phone.publicKeyBase64,
    macEphemeralPublicKey: serverHello.macEphemeralPublicKey,
    phoneEphemeralPublicKey: phoneEphemeral.publicKeyBase64,
    clientNonce,
    serverNonce: Buffer.from(serverHello.serverNonce, 'base64'),
    expiresAtForTranscript: serverHello.expiresAtForTranscript,
  })

  const clientAuthTranscript = Buffer.concat([
    transcript,
    encodeLengthPrefixedUtf8('client-auth'),
  ])
  const phoneSignature = signTranscriptWithPhone(
    phone.privateKeyBase64,
    phone.publicKeyBase64,
    clientAuthTranscript,
  )

  // clientAuth
  transport.handleIncomingWireMessage(
    JSON.stringify({
      kind: 'clientAuth',
      sessionId,
      phoneDeviceId: phone.phoneDeviceId,
      keyEpoch: serverHello.keyEpoch,
      phoneSignature,
    }),
    { sendControlMessage: send, onApplicationMessage: () => {} },
  )
  const secureReady = sent.find((m) => m?.kind === 'secureReady')
  if (!secureReady) throw new Error('secureReady not produced — sent: ' + JSON.stringify(sent))

  // Derive symmetric keys the same way the bridge does so we can both encrypt
  // outbound iPhone-side frames and decrypt the bridge's responses.
  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey({
      key: {
        crv: 'X25519',
        d: base64ToBase64Url(phoneEphemeral.privateKeyBase64),
        kty: 'OKP',
        x: base64ToBase64Url(phoneEphemeral.publicKeyBase64),
      },
      format: 'jwk',
    }),
    publicKey: createPublicKey({
      key: {
        crv: 'X25519',
        kty: 'OKP',
        x: base64ToBase64Url(serverHello.macEphemeralPublicKey),
      },
      format: 'jwk',
    }),
  })
  const { createHash } = require('node:crypto')
  const salt = createHash('sha256').update(transcript).digest()
  const infoPrefix = [
    HANDSHAKE_TAG,
    sessionId,
    macDeviceId,
    phone.phoneDeviceId,
    String(serverHello.keyEpoch),
  ].join('|')
  const phoneToMacKey = deriveAesKey(sharedSecret, salt, `${infoPrefix}|phoneToMac`)
  const macToPhoneKey = deriveAesKey(sharedSecret, salt, `${infoPrefix}|macToPhone`)

  return {
    clientNonce,
    serverHello,
    secureReady,
    phoneToMacKey,
    macToPhoneKey,
    inboundCounter: 0,
  }
}

describe('mobile-secure-transport handshake', () => {
  test('qr_bootstrap → secureReady and produces a usable shared key', () => {
    const state = makeMacDeviceState()
    const sessionId = 'session-' + Math.random().toString(36).slice(2)
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: 'ws://127.0.0.1:3987/ws',
      deviceState: state,
      displayName: 'Tester',
    })
    const phone = makePhoneIdentity()
    const result = drivePairing({
      transport,
      sessionId,
      macDeviceId: state.macDeviceId,
      macIdentityPublicKey: state.macIdentityPublicKey,
      phone,
      handshakeMode: HANDSHAKE_MODE_QR_BOOTSTRAP,
    })
    expect(result.serverHello.handshakeMode).toBe(HANDSHAKE_MODE_QR_BOOTSTRAP)
    expect(transport.isSecureChannelReady()).toBe(false) // resume not yet sent
    expect(transport.__inspect().activeSession?.keyEpoch).toBe(1)
  })

  test('rejects trusted_reconnect from an unknown phone', () => {
    const state = makeMacDeviceState()
    const sessionId = 'session-' + Math.random().toString(36).slice(2)
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: 'ws://127.0.0.1:3987/ws',
      deviceState: state,
    })
    const phone = makePhoneIdentity()
    const phoneEphemeral = makePhoneEphemeral()
    const sent: any[] = []
    transport.handleIncomingWireMessage(
      JSON.stringify({
        kind: 'clientHello',
        protocolVersion: SECURE_PROTOCOL_VERSION,
        sessionId,
        handshakeMode: HANDSHAKE_MODE_TRUSTED_RECONNECT,
        phoneDeviceId: phone.phoneDeviceId,
        phoneIdentityPublicKey: phone.publicKeyBase64,
        phoneEphemeralPublicKey: phoneEphemeral.publicKeyBase64,
        clientNonce: randomBytes(16).toString('base64'),
      }),
      { sendControlMessage: (m) => sent.push(m), onApplicationMessage: () => {} },
    )
    expect(sent[0]?.kind).toBe('secureError')
    expect(sent[0]?.code).toBe('phone_not_trusted')
  })

  test('rejects wrong protocol version', () => {
    const state = makeMacDeviceState()
    const sessionId = 'session-' + Math.random().toString(36).slice(2)
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: 'ws://127.0.0.1:3987/ws',
      deviceState: state,
    })
    const phone = makePhoneIdentity()
    const phoneEphemeral = makePhoneEphemeral()
    const sent: any[] = []
    transport.handleIncomingWireMessage(
      JSON.stringify({
        kind: 'clientHello',
        protocolVersion: SECURE_PROTOCOL_VERSION + 99,
        sessionId,
        handshakeMode: HANDSHAKE_MODE_QR_BOOTSTRAP,
        phoneDeviceId: phone.phoneDeviceId,
        phoneIdentityPublicKey: phone.publicKeyBase64,
        phoneEphemeralPublicKey: phoneEphemeral.publicKeyBase64,
        clientNonce: randomBytes(16).toString('base64'),
      }),
      { sendControlMessage: (m) => sent.push(m), onApplicationMessage: () => {} },
    )
    expect(sent[0]?.kind).toBe('secureError')
    expect(sent[0]?.code).toBe('update_required')
  })

  test('rejects expired pairing window in qr_bootstrap', () => {
    const state = makeMacDeviceState()
    const sessionId = 'session-expired'
    let now = 1_000_000
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: 'ws://127.0.0.1:3987/ws',
      deviceState: state,
      nowMs: () => now,
    })
    transport.createPairingPayload()
    now += 10 * 60 * 1000 // 10m later — past MAX_PAIRING_AGE_MS
    const phone = makePhoneIdentity()
    const phoneEphemeral = makePhoneEphemeral()
    const sent: any[] = []
    transport.handleIncomingWireMessage(
      JSON.stringify({
        kind: 'clientHello',
        protocolVersion: SECURE_PROTOCOL_VERSION,
        sessionId,
        handshakeMode: HANDSHAKE_MODE_QR_BOOTSTRAP,
        phoneDeviceId: phone.phoneDeviceId,
        phoneIdentityPublicKey: phone.publicKeyBase64,
        phoneEphemeralPublicKey: phoneEphemeral.publicKeyBase64,
        clientNonce: randomBytes(16).toString('base64'),
      }),
      { sendControlMessage: (m) => sent.push(m), onApplicationMessage: () => {} },
    )
    expect(sent[0]?.kind).toBe('secureError')
    expect(sent[0]?.code).toBe('pairing_expired')
  })

  test('encrypted envelope roundtrip phone → bridge', () => {
    const state = makeMacDeviceState()
    const sessionId = 'roundtrip-session'
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: 'ws://127.0.0.1:3987/ws',
      deviceState: state,
    })
    const phone = makePhoneIdentity()
    const pairing = drivePairing({
      transport,
      sessionId,
      macDeviceId: state.macDeviceId,
      macIdentityPublicKey: state.macIdentityPublicKey,
      phone,
      handshakeMode: HANDSHAKE_MODE_QR_BOOTSTRAP,
    })

    const inboundCounter = 0
    const plaintext = JSON.stringify({ payloadText: '{"jsonrpc":"2.0","method":"session.list"}' })
    const envelope = encryptFromPhone(
      plaintext,
      pairing.phoneToMacKey,
      inboundCounter,
      sessionId,
      pairing.serverHello.keyEpoch,
    )
    let receivedPayload = ''
    transport.handleIncomingWireMessage(JSON.stringify(envelope), {
      sendControlMessage: () => {},
      onApplicationMessage: (payloadText) => { receivedPayload = payloadText },
    })
    expect(receivedPayload).toBe('{"jsonrpc":"2.0","method":"session.list"}')
  })

  test('replay-resistance: same counter is rejected', () => {
    const state = makeMacDeviceState()
    const sessionId = 'replay-session'
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: 'ws://127.0.0.1:3987/ws',
      deviceState: state,
    })
    const phone = makePhoneIdentity()
    const pairing = drivePairing({
      transport,
      sessionId,
      macDeviceId: state.macDeviceId,
      macIdentityPublicKey: state.macIdentityPublicKey,
      phone,
      handshakeMode: HANDSHAKE_MODE_QR_BOOTSTRAP,
    })

    const envelope = encryptFromPhone(
      JSON.stringify({ payloadText: 'first' }),
      pairing.phoneToMacKey,
      0,
      sessionId,
      pairing.serverHello.keyEpoch,
    )
    const seenA: any[] = []
    transport.handleIncomingWireMessage(JSON.stringify(envelope), {
      sendControlMessage: (m) => seenA.push(m),
      onApplicationMessage: () => {},
    })
    // Same counter again → reject.
    const seenB: any[] = []
    transport.handleIncomingWireMessage(JSON.stringify(envelope), {
      sendControlMessage: (m) => seenB.push(m),
      onApplicationMessage: () => {},
    })
    expect(seenB[0]?.kind).toBe('secureError')
    expect(seenB[0]?.code).toBe('invalid_envelope')
  })

  test('trusted-reconnect path succeeds when the phone is pre-trusted', () => {
    const phone = makePhoneIdentity()
    const baseState = makeMacDeviceState()
    const state: BridgeSecureTransportDeviceState = {
      ...baseState,
      trustedPhones: { [phone.phoneDeviceId]: phone.publicKeyBase64 },
    }
    const sessionId = 'reconnect-session'
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: 'ws://127.0.0.1:3987/ws',
      deviceState: state,
    })
    const result = drivePairing({
      transport,
      sessionId,
      macDeviceId: state.macDeviceId,
      macIdentityPublicKey: state.macIdentityPublicKey,
      phone,
      handshakeMode: HANDSHAKE_MODE_TRUSTED_RECONNECT,
    })
    expect(result.secureReady.kind).toBe('secureReady')
  })

  test('outbound buffer trims past MAX_BRIDGE_OUTBOUND_MESSAGES', () => {
    const state = makeMacDeviceState()
    const sessionId = 'trim-session'
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: 'ws://127.0.0.1:3987/ws',
      deviceState: state,
    })
    // No active session — entries still go into the buffer and get trimmed.
    const max = __testing.MAX_BRIDGE_OUTBOUND_MESSAGES
    for (let i = 0; i < max + 50; i += 1) {
      transport.queueOutboundApplicationMessage(`payload-${i}`)
    }
    expect(transport.__inspect().outboundBufferLength).toBeLessThanOrEqual(max)
  })

  test('nonceForDirection distinguishes mac vs iphone', () => {
    expect(nonceForDirection('mac', 0)[0]).toBe(1)
    expect(nonceForDirection('iphone', 0)[0]).toBe(2)
    expect(nonceForDirection('mac', 257)[10]).toBe(1)
    expect(nonceForDirection('mac', 257)[11]).toBe(1)
  })
})

function encryptFromPhone(
  plaintext: string,
  phoneToMacKey: Buffer,
  counter: number,
  sessionId: string,
  keyEpoch: number,
): EncryptedEnvelope {
  const { createCipheriv } = require('node:crypto')
  const nonce = nonceForDirection(SECURE_SENDER_IPHONE, counter)
  const cipher = createCipheriv('aes-256-gcm', phoneToMacKey, nonce)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    kind: 'encryptedEnvelope',
    v: SECURE_PROTOCOL_VERSION,
    sessionId,
    keyEpoch,
    sender: SECURE_SENDER_IPHONE,
    counter,
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  }
}
