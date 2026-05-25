// FILE: ConstellagentSecureTransportModels.swift
// Purpose: Defines the wire payloads, device trust records, and crypto helpers for Constellagent E2EE.
// Layer: Service support
// Exports: Pairing/session models plus transcript, nonce, and key utility helpers
// Depends on: Foundation, CryptoKit

import CryptoKit
import Foundation

let constellagentSecureProtocolVersion = 1
let constellagentPairingQRVersion = 2
let constellagentSecureHandshakeTag = "constellagent-e2ee-v1"
let constellagentSecureHandshakeLabel = "client-auth"
let constellagentSecureClockSkewToleranceSeconds: TimeInterval = 60
let constellagentTrustedSessionResolveTag = "constellagent-trusted-session-resolve-v1"
let constellagentTrustedSessionResolveClockSkewToleranceSeconds: TimeInterval = 90

enum ConstellagentSecureHandshakeMode: String, Codable, Sendable {
    case qrBootstrap = "qr_bootstrap"
    case trustedReconnect = "trusted_reconnect"
}

enum ConstellagentSecureConnectionState: Equatable, Sendable {
    case notPaired
    case trustedMac
    case liveSessionUnresolved
    case handshaking
    case encrypted
    case reconnecting
    case rePairRequired
    case updateRequired
}

struct ConstellagentPairingQRPayload: Codable, Sendable {
    let v: Int
    let relay: String
    let sessionId: String
    let macDeviceId: String
    let macIdentityPublicKey: String
    let expiresAt: Int64
    var displayName: String? = nil
}

struct ConstellagentPhoneIdentityState: Codable, Sendable {
    let phoneDeviceId: String
    let phoneIdentityPrivateKey: String
    let phoneIdentityPublicKey: String
}

struct ConstellagentTrustedMacRecord: Codable, Sendable {
    let macDeviceId: String
    let macIdentityPublicKey: String
    let lastPairedAt: Date
    var relayURL: String? = nil
    var displayName: String? = nil
    var lastResolvedSessionId: String? = nil
    var lastResolvedAt: Date? = nil
    var lastUsedAt: Date? = nil
}

struct ConstellagentTrustedMacRegistry: Codable, Sendable {
    var records: [String: ConstellagentTrustedMacRecord]

    static let empty = ConstellagentTrustedMacRegistry(records: [:])
}

struct SecureClientHello: Codable, Sendable {
    let kind: String
    let protocolVersion: Int
    let sessionId: String
    let handshakeMode: ConstellagentSecureHandshakeMode
    let phoneDeviceId: String
    let phoneIdentityPublicKey: String
    let phoneEphemeralPublicKey: String
    let clientNonce: String

    init(
        kind: String = "clientHello",
        protocolVersion: Int,
        sessionId: String,
        handshakeMode: ConstellagentSecureHandshakeMode,
        phoneDeviceId: String,
        phoneIdentityPublicKey: String,
        phoneEphemeralPublicKey: String,
        clientNonce: String
    ) {
        self.kind = kind
        self.protocolVersion = protocolVersion
        self.sessionId = sessionId
        self.handshakeMode = handshakeMode
        self.phoneDeviceId = phoneDeviceId
        self.phoneIdentityPublicKey = phoneIdentityPublicKey
        self.phoneEphemeralPublicKey = phoneEphemeralPublicKey
        self.clientNonce = clientNonce
    }
}

struct SecureServerHello: Codable, Sendable {
    let kind: String
    let protocolVersion: Int
    let sessionId: String
    let handshakeMode: ConstellagentSecureHandshakeMode
    let macDeviceId: String
    let macIdentityPublicKey: String
    let macEphemeralPublicKey: String
    let serverNonce: String
    let keyEpoch: Int
    let expiresAtForTranscript: Int64
    let macSignature: String
    let clientNonce: String?
    var displayName: String? = nil
}

struct SecureClientAuth: Codable, Sendable {
    let kind: String
    let sessionId: String
    let phoneDeviceId: String
    let keyEpoch: Int
    let phoneSignature: String

    init(
        kind: String = "clientAuth",
        sessionId: String,
        phoneDeviceId: String,
        keyEpoch: Int,
        phoneSignature: String
    ) {
        self.kind = kind
        self.sessionId = sessionId
        self.phoneDeviceId = phoneDeviceId
        self.keyEpoch = keyEpoch
        self.phoneSignature = phoneSignature
    }
}

struct SecureReadyMessage: Codable, Sendable {
    let kind: String
    let sessionId: String
    let keyEpoch: Int
    let macDeviceId: String
}

struct SecureResumeState: Codable, Sendable {
    let kind: String
    let sessionId: String
    let keyEpoch: Int
    let lastAppliedBridgeOutboundSeq: Int

    init(
        kind: String = "resumeState",
        sessionId: String,
        keyEpoch: Int,
        lastAppliedBridgeOutboundSeq: Int
    ) {
        self.kind = kind
        self.sessionId = sessionId
        self.keyEpoch = keyEpoch
        self.lastAppliedBridgeOutboundSeq = lastAppliedBridgeOutboundSeq
    }
}

struct SecureErrorMessage: Codable, Sendable {
    let kind: String
    let code: String
    let message: String
}

struct SecureEnvelope: Codable, Sendable {
    let kind: String
    let v: Int
    let sessionId: String
    let keyEpoch: Int
    let sender: String
    let counter: Int
    let ciphertext: String
    let tag: String
}

struct SecureApplicationPayload: Codable, Sendable {
    let bridgeOutboundSeq: Int?
    let payloadText: String
}

struct ConstellagentSecureSession {
    let sessionId: String
    let keyEpoch: Int
    let macDeviceId: String
    let macIdentityPublicKey: String
    let phoneToMacKey: SymmetricKey
    let macToPhoneKey: SymmetricKey
    var lastInboundBridgeOutboundSeq: Int
    var lastInboundCounter: Int
    var nextOutboundCounter: Int
}

struct ConstellagentTrustedSessionResolveRequest: Codable, Sendable {
    let macDeviceId: String
    let phoneDeviceId: String
    let phoneIdentityPublicKey: String
    let nonce: String
    let timestamp: Int64
    let signature: String
}

struct ConstellagentTrustedSessionResolveResponse: Codable, Sendable {
    let ok: Bool
    let macDeviceId: String
    let macIdentityPublicKey: String
    let displayName: String?
    let sessionId: String
}

struct ConstellagentPairingCodeResolveResponse: Codable, Sendable {
    let ok: Bool
    let v: Int
    let sessionId: String
    let macDeviceId: String
    let macIdentityPublicKey: String
    let expiresAt: Int64
    var displayName: String? = nil
}

struct ConstellagentRelayErrorResponse: Codable, Sendable {
    let ok: Bool?
    let error: String?
    let code: String?
}

struct ConstellagentPendingHandshake {
    let mode: ConstellagentSecureHandshakeMode
    let transcriptBytes: Data
    let phoneEphemeralPrivateKey: Curve25519.KeyAgreement.PrivateKey
    let phoneDeviceId: String
}

enum ConstellagentSecureTransportError: LocalizedError {
    case invalidQR(String)
    case secureError(String)
    case incompatibleVersion(String)
    case invalidHandshake(String)
    case decryptFailed
    case timedOut(String)

    var errorDescription: String? {
        switch self {
        case .invalidQR(let message),
             .secureError(let message),
             .incompatibleVersion(let message),
             .invalidHandshake(let message),
             .timedOut(let message):
            return message
        case .decryptFailed:
            return "Unable to decrypt the secure Constellagent payload."
        }
    }
}

enum ConstellagentTrustedSessionResolveError: LocalizedError {
    case noTrustedMac
    case unsupportedRelay
    case macOffline(String)
    case rePairRequired(String)
    case invalidResponse(String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .noTrustedMac:
            return "No trusted device is available to reconnect."
        case .unsupportedRelay:
            return "This relay does not support trusted reconnect yet."
        case .macOffline(let message),
             .rePairRequired(let message),
             .invalidResponse(let message),
             .network(let message):
            return message
        }
    }
}

extension ConstellagentSecureConnectionState {
    var statusLabel: String {
        switch self {
        case .notPaired:
            return "Not paired"
        case .trustedMac:
            return "Trusted Device"
        case .liveSessionUnresolved:
            return "Trusted Device ready"
        case .handshaking:
            return "Secure handshake in progress"
        case .encrypted:
            return "End-to-end encrypted"
        case .reconnecting:
            return "Reconnecting securely"
        case .rePairRequired:
            return "Re-pair required"
        case .updateRequired:
            return "Update required"
        }
    }
}

func constellagentTrustedSessionResolveTranscriptBytes(
    macDeviceId: String,
    phoneDeviceId: String,
    phoneIdentityPublicKey: String,
    nonce: String,
    timestamp: Int64
) -> Data {
    var data = Data()
    data.appendLengthPrefixedUTF8(constellagentTrustedSessionResolveTag)
    data.appendLengthPrefixedUTF8(macDeviceId)
    data.appendLengthPrefixedUTF8(phoneDeviceId)
    data.appendLengthPrefixedData(Data(base64EncodedOrEmpty: phoneIdentityPublicKey))
    data.appendLengthPrefixedUTF8(nonce)
    data.appendLengthPrefixedUTF8(String(timestamp))
    return data
}

// Builds the exact transcript bytes used by both signatures and HKDF salt.
func constellagentSecureTranscriptBytes(
    sessionId: String,
    protocolVersion: Int,
    handshakeMode: ConstellagentSecureHandshakeMode,
    keyEpoch: Int,
    macDeviceId: String,
    phoneDeviceId: String,
    macIdentityPublicKey: String,
    phoneIdentityPublicKey: String,
    macEphemeralPublicKey: String,
    phoneEphemeralPublicKey: String,
    clientNonce: Data,
    serverNonce: Data,
    expiresAtForTranscript: Int64
) -> Data {
    var data = Data()
    data.appendLengthPrefixedUTF8(constellagentSecureHandshakeTag)
    data.appendLengthPrefixedUTF8(sessionId)
    data.appendLengthPrefixedUTF8(String(protocolVersion))
    data.appendLengthPrefixedUTF8(handshakeMode.rawValue)
    data.appendLengthPrefixedUTF8(String(keyEpoch))
    data.appendLengthPrefixedUTF8(macDeviceId)
    data.appendLengthPrefixedUTF8(phoneDeviceId)
    data.appendLengthPrefixedData(Data(base64EncodedOrEmpty: macIdentityPublicKey))
    data.appendLengthPrefixedData(Data(base64EncodedOrEmpty: phoneIdentityPublicKey))
    data.appendLengthPrefixedData(Data(base64EncodedOrEmpty: macEphemeralPublicKey))
    data.appendLengthPrefixedData(Data(base64EncodedOrEmpty: phoneEphemeralPublicKey))
    data.appendLengthPrefixedData(clientNonce)
    data.appendLengthPrefixedData(serverNonce)
    data.appendLengthPrefixedUTF8(String(expiresAtForTranscript))
    return data
}

// Keeps the client-auth signature domain-separated from the shared transcript signature.
func constellagentClientAuthTranscript(from transcriptBytes: Data) -> Data {
    var data = transcriptBytes
    data.appendLengthPrefixedUTF8(constellagentSecureHandshakeLabel)
    return data
}

// Derives the deterministic AES-GCM nonce from direction + counter.
func constellagentSecureNonce(sender: String, counter: Int) -> Data {
    var nonce = Data(repeating: 0, count: 12)
    nonce[0] = (sender == "mac") ? 1 : 2
    var remaining = UInt64(counter)
    for index in stride(from: 11, through: 1, by: -1) {
        nonce[index] = UInt8(remaining & 0xff)
        remaining >>= 8
    }
    return nonce
}

func constellagentSecureFingerprint(for publicKeyBase64: String) -> String {
    let digest = SHA256.hash(data: Data(base64EncodedOrEmpty: publicKeyBase64))
    return digest.compactMap { String(format: "%02x", $0) }.joined().prefix(12).uppercased()
}

func constellagentPhoneIdentityStateFromSecureStore() -> ConstellagentPhoneIdentityState {
    if let existing: ConstellagentPhoneIdentityState = SecureStore.readCodable(
        ConstellagentPhoneIdentityState.self,
        for: ConstellagentSecureKeys.phoneIdentityState
    ) {
        return existing
    }

    let privateKey = Curve25519.Signing.PrivateKey()
    let next = ConstellagentPhoneIdentityState(
        phoneDeviceId: UUID().uuidString,
        phoneIdentityPrivateKey: privateKey.rawRepresentation.base64EncodedString(),
        phoneIdentityPublicKey: privateKey.publicKey.rawRepresentation.base64EncodedString()
    )
    SecureStore.writeCodable(next, for: ConstellagentSecureKeys.phoneIdentityState)
    return next
}

func constellagentTrustedMacRegistryFromSecureStore() -> ConstellagentTrustedMacRegistry {
    SecureStore.readCodable(ConstellagentTrustedMacRegistry.self, for: ConstellagentSecureKeys.trustedMacRegistry)
    ?? .empty
}

extension Data {
    init(base64EncodedOrEmpty value: String) {
        self = Data(base64Encoded: value) ?? Data()
    }

    mutating func appendLengthPrefixedUTF8(_ value: String) {
        appendLengthPrefixedData(Data(value.utf8))
    }

    mutating func appendLengthPrefixedData(_ value: Data) {
        var length = UInt32(value.count).bigEndian
        append(Data(bytes: &length, count: MemoryLayout<UInt32>.size))
        append(value)
    }
}
