// FILE: ConstellagentService+SecureTransport.swift
// Purpose: Performs the iPhone-side E2EE handshake, wire control routing, and encrypted envelope handling.
// Layer: Service
// Exports: ConstellagentService secure transport helpers
// Depends on: CryptoKit, Foundation, Security, Network

import CryptoKit
import Foundation
import Security

extension ConstellagentService {
    // Completes the secure handshake before any JSON-RPC traffic is sent over the relay.
    func performSecureHandshake() async throws {
        guard let sessionId = normalizedRelaySessionId,
              let macDeviceId = normalizedRelayMacDeviceId else {
            throw ConstellagentSecureTransportError.invalidHandshake(
                "The saved relay pairing is incomplete. Scan a fresh QR code to reconnect."
            )
        }

        let trustedMac = trustedMacRegistry.records[macDeviceId]
        // Fresh QR scans must go through bootstrap once so we verify the scanned session,
        // instead of silently reusing an older trusted-reconnect path.
        let handshakeMode: ConstellagentSecureHandshakeMode = (!shouldForceQRBootstrapOnNextHandshake && trustedMac != nil)
            ? .trustedReconnect
            : .qrBootstrap
        let expectedMacIdentityPublicKey: String
        switch handshakeMode {
        case .trustedReconnect:
            expectedMacIdentityPublicKey = trustedMac?.macIdentityPublicKey ?? ""
            secureConnectionState = .reconnecting
        case .qrBootstrap:
            guard let pairingPublicKey = normalizedRelayMacIdentityPublicKey else {
                throw ConstellagentSecureTransportError.invalidHandshake(
                    "The initial pairing metadata is missing the device identity key. Scan a new QR code to reconnect."
                )
            }
            expectedMacIdentityPublicKey = pairingPublicKey
            secureConnectionState = .handshaking
        }

        let phoneEphemeralPrivateKey = Curve25519.KeyAgreement.PrivateKey()
        let clientNonce = randomSecureNonce()
        let clientHello = SecureClientHello(
            protocolVersion: relayProtocolVersion,
            sessionId: sessionId,
            handshakeMode: handshakeMode,
            phoneDeviceId: phoneIdentityState.phoneDeviceId,
            phoneIdentityPublicKey: phoneIdentityState.phoneIdentityPublicKey,
            phoneEphemeralPublicKey: phoneEphemeralPrivateKey.publicKey.rawRepresentation.base64EncodedString(),
            clientNonce: clientNonce.base64EncodedString()
        )
        pendingHandshake = ConstellagentPendingHandshake(
            mode: handshakeMode,
            transcriptBytes: Data(),
            phoneEphemeralPrivateKey: phoneEphemeralPrivateKey,
            phoneDeviceId: phoneIdentityState.phoneDeviceId
        )
        try await sendWireControlMessage(clientHello)

        let serverHello = try await waitForMatchingServerHello(
            expectedSessionId: sessionId,
            expectedMacDeviceId: macDeviceId,
            expectedMacIdentityPublicKey: expectedMacIdentityPublicKey,
            expectedClientNonce: clientHello.clientNonce,
            clientNonce: clientNonce,
            phoneDeviceId: phoneIdentityState.phoneDeviceId,
            phoneIdentityPublicKey: phoneIdentityState.phoneIdentityPublicKey,
            phoneEphemeralPublicKey: clientHello.phoneEphemeralPublicKey
        )
        guard serverHello.protocolVersion == constellagentSecureProtocolVersion else {
            presentBridgeUpdatePrompt(
                message: "This bridge is using a different secure transport version. Update the Constellagent package on your device and try again."
            )
            throw ConstellagentSecureTransportError.incompatibleVersion(
                "This bridge is using a different secure transport version. Update Constellagent on the iPhone or paired device and try again."
            )
        }
        guard serverHello.sessionId == sessionId else {
            throw ConstellagentSecureTransportError.invalidHandshake("The secure bridge session ID did not match the saved pairing.")
        }
        guard serverHello.macDeviceId == macDeviceId else {
            throw ConstellagentSecureTransportError.invalidHandshake("The bridge reported a different device identity for this relay session.")
        }
        guard serverHello.macIdentityPublicKey == expectedMacIdentityPublicKey else {
            throw ConstellagentSecureTransportError.invalidHandshake("The secure device identity key did not match the paired device.")
        }

        let serverNonce = Data(base64EncodedOrEmpty: serverHello.serverNonce)
        let transcriptBytes = constellagentSecureTranscriptBytes(
            sessionId: sessionId,
            protocolVersion: serverHello.protocolVersion,
            handshakeMode: serverHello.handshakeMode,
            keyEpoch: serverHello.keyEpoch,
            macDeviceId: serverHello.macDeviceId,
            phoneDeviceId: phoneIdentityState.phoneDeviceId,
            macIdentityPublicKey: serverHello.macIdentityPublicKey,
            phoneIdentityPublicKey: phoneIdentityState.phoneIdentityPublicKey,
            macEphemeralPublicKey: serverHello.macEphemeralPublicKey,
            phoneEphemeralPublicKey: clientHello.phoneEphemeralPublicKey,
            clientNonce: clientNonce,
            serverNonce: serverNonce,
            expiresAtForTranscript: serverHello.expiresAtForTranscript
        )
        debugSecureLog(
            "verify mode=\(serverHello.handshakeMode.rawValue) session=\(shortSecureId(sessionId)) "
            + "keyEpoch=\(serverHello.keyEpoch) mac=\(shortSecureId(serverHello.macDeviceId)) "
            + "phone=\(shortSecureId(phoneIdentityState.phoneDeviceId)) "
            + "expectedMacKey=\(shortSecureFingerprint(expectedMacIdentityPublicKey)) "
            + "actualMacKey=\(shortSecureFingerprint(serverHello.macIdentityPublicKey)) "
            + "phoneKey=\(shortSecureFingerprint(phoneIdentityState.phoneIdentityPublicKey)) "
            + "transcript=\(shortTranscriptDigest(transcriptBytes))"
        )
        let macPublicKey = try Curve25519.Signing.PublicKey(
            rawRepresentation: Data(base64EncodedOrEmpty: serverHello.macIdentityPublicKey)
        )
        let macSignature = Data(base64EncodedOrEmpty: serverHello.macSignature)
        let isSignatureValid = macPublicKey.isValidSignature(macSignature, for: transcriptBytes)
        debugSecureLog(
            "verify-result mode=\(serverHello.handshakeMode.rawValue) valid=\(isSignatureValid) "
            + "signature=\(shortTranscriptDigest(macSignature))"
        )
        guard isSignatureValid else {
            throw ConstellagentSecureTransportError.invalidHandshake("The secure device signature could not be verified.")
        }

        pendingHandshake = ConstellagentPendingHandshake(
            mode: handshakeMode,
            transcriptBytes: transcriptBytes,
            phoneEphemeralPrivateKey: phoneEphemeralPrivateKey,
            phoneDeviceId: phoneIdentityState.phoneDeviceId
        )

        let phonePrivateKey = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(base64EncodedOrEmpty: phoneIdentityState.phoneIdentityPrivateKey)
        )
        let phoneSignatureData = try phonePrivateKey.signature(for: constellagentClientAuthTranscript(from: transcriptBytes))
        let clientAuth = SecureClientAuth(
            sessionId: sessionId,
            phoneDeviceId: phoneIdentityState.phoneDeviceId,
            keyEpoch: serverHello.keyEpoch,
            phoneSignature: phoneSignatureData.base64EncodedString()
        )
        try await sendWireControlMessage(clientAuth)

        _ = try await waitForMatchingSecureReady(
            expectedSessionId: sessionId,
            expectedKeyEpoch: serverHello.keyEpoch,
            expectedMacDeviceId: macDeviceId
        )

        let macEphemeralPublicKey = try Curve25519.KeyAgreement.PublicKey(
            rawRepresentation: Data(base64EncodedOrEmpty: serverHello.macEphemeralPublicKey)
        )
        let sharedSecret = try phoneEphemeralPrivateKey.sharedSecretFromKeyAgreement(with: macEphemeralPublicKey)
        let salt = SHA256.hash(data: transcriptBytes)
        let infoPrefix = "\(constellagentSecureHandshakeTag)|\(sessionId)|\(macDeviceId)|\(phoneIdentityState.phoneDeviceId)|\(serverHello.keyEpoch)"
        let phoneToMacKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(salt),
            sharedInfo: Data("\(infoPrefix)|phoneToMac".utf8),
            outputByteCount: 32
        )
        let macToPhoneKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(salt),
            sharedInfo: Data("\(infoPrefix)|macToPhone".utf8),
            outputByteCount: 32
        )

        secureSession = ConstellagentSecureSession(
            sessionId: sessionId,
            keyEpoch: serverHello.keyEpoch,
            macDeviceId: macDeviceId,
            macIdentityPublicKey: serverHello.macIdentityPublicKey,
            phoneToMacKey: phoneToMacKey,
            macToPhoneKey: macToPhoneKey,
            lastInboundBridgeOutboundSeq: lastAppliedBridgeOutboundSeq,
            lastInboundCounter: -1,
            nextOutboundCounter: 0
        )
        pendingHandshake = nil
        shouldForceQRBootstrapOnNextHandshake = false
        secureConnectionState = .encrypted
        secureMacFingerprint = constellagentSecureFingerprint(for: serverHello.macIdentityPublicKey)
        bridgeUpdatePrompt = nil

        if handshakeMode == .qrBootstrap {
            trustMac(
                deviceId: macDeviceId,
                publicKey: serverHello.macIdentityPublicKey,
                relayURL: normalizedRelayURL,
                displayName: serverHello.displayName ?? trustedMac?.displayName,
                liveSessionId: sessionId
            )
        }

        try await sendWireControlMessage(
            SecureResumeState(
                sessionId: sessionId,
                keyEpoch: serverHello.keyEpoch,
                lastAppliedBridgeOutboundSeq: lastAppliedBridgeOutboundSeq
            )
        )
    }

    // Handles raw relay JSON before any JSON-RPC decoding so secure controls stay separate.
    func processIncomingWireText(_ text: String) {
        if let kind = wireMessageKind(from: text) {
            switch kind {
            case "serverHello", "secureReady", "secureError":
                bufferSecureControlMessage(kind: kind, rawText: text)
                return
            case "encryptedEnvelope":
                handleEncryptedEnvelopeText(text)
                return
            default:
                break
            }
        }

        processIncomingText(text)
    }

    // Encrypts JSON-RPC requests/responses before they leave the iPhone.
    func secureWireText(for plaintext: String) throws -> String {
        guard var secureSession else {
            throw ConstellagentSecureTransportError.invalidHandshake(
                "The secure Constellagent session is not ready yet. Try reconnecting."
            )
        }

        let payload = SecureApplicationPayload(
            bridgeOutboundSeq: nil,
            payloadText: plaintext
        )
        let payloadData = try JSONEncoder().encode(payload)
        let nonceData = constellagentSecureNonce(sender: "iphone", counter: secureSession.nextOutboundCounter)
        let nonce = try AES.GCM.Nonce(data: nonceData)
        let sealedBox = try AES.GCM.seal(payloadData, using: secureSession.phoneToMacKey, nonce: nonce)
        let envelope = SecureEnvelope(
            kind: "encryptedEnvelope",
            v: constellagentSecureProtocolVersion,
            sessionId: secureSession.sessionId,
            keyEpoch: secureSession.keyEpoch,
            sender: "iphone",
            counter: secureSession.nextOutboundCounter,
            ciphertext: sealedBox.ciphertext.base64EncodedString(),
            tag: sealedBox.tag.base64EncodedString()
        )
        secureSession.nextOutboundCounter += 1
        self.secureSession = secureSession
        let data = try JSONEncoder().encode(envelope)
        guard let text = String(data: data, encoding: .utf8) else {
            throw ConstellagentSecureTransportError.invalidHandshake("Unable to encode the secure Constellagent envelope.")
        }
        return text
    }

    // Saves the QR-derived bridge metadata used for secure reconnects.
    func rememberRelayPairing(_ payload: ConstellagentPairingQRPayload) {
        SecureStore.writeString(payload.sessionId, for: ConstellagentSecureKeys.relaySessionId)
        SecureStore.writeString(payload.relay, for: ConstellagentSecureKeys.relayUrl)
        SecureStore.writeString(payload.macDeviceId, for: ConstellagentSecureKeys.relayMacDeviceId)
        SecureStore.writeString(payload.macIdentityPublicKey, for: ConstellagentSecureKeys.relayMacIdentityPublicKey)
        SecureStore.writeString(String(constellagentSecureProtocolVersion), for: ConstellagentSecureKeys.relayProtocolVersion)
        SecureStore.writeString("0", for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq)
        relaySessionId = payload.sessionId
        relayUrl = payload.relay
        relayMacDeviceId = payload.macDeviceId
        relayMacIdentityPublicKey = payload.macIdentityPublicKey
        relayProtocolVersion = constellagentSecureProtocolVersion
        lastAppliedBridgeOutboundSeq = 0
        shouldForceQRBootstrapOnNextHandshake = true
        trustedReconnectFailureCount = 0
        secureConnectionState = trustedMacRegistry.records[payload.macDeviceId] == nil ? .handshaking : .trustedMac
        secureMacFingerprint = constellagentSecureFingerprint(for: payload.macIdentityPublicKey)
    }

    // Resets volatile secure state while preserving the trusted-device registry.
    func resetSecureTransportState(preservePendingQRBootstrapState: Bool = false) {
        secureSession = nil
        pendingHandshake = nil
        let continuations = pendingSecureControlContinuations
        pendingSecureControlContinuations.removeAll()
        bufferedSecureControlMessages.removeAll()

        for waiters in continuations.values {
            for waiter in waiters {
                waiter.continuation.resume(throwing: ConstellagentServiceError.disconnected)
            }
        }

        if secureConnectionState == .rePairRequired || secureConnectionState == .updateRequired {
            return
        }

        if shouldForceQRBootstrapOnNextHandshake, normalizedRelaySessionId != nil {
            // Fresh scans should stay visually "in progress" while the connect path is spinning up,
            // but real disconnects still fall back to a stable saved-pair/not-paired presentation.
            if preservePendingQRBootstrapState {
                secureConnectionState = trustedMacRegistry.records[relayMacDeviceId ?? ""] == nil ? .handshaking : .trustedMac
            } else {
                secureConnectionState = trustedMacRegistry.records[relayMacDeviceId ?? ""] == nil ? .notPaired : .trustedMac
            }
            secureMacFingerprint = normalizedRelayMacIdentityPublicKey.map { constellagentSecureFingerprint(for: $0) }
            return
        }

        restoreTrustedPairPresentationState()
    }

    // Rebuilds the saved-pair UI state from persisted trust without touching sockets or keys.
    func restoreTrustedPairPresentationState() {
        if let relayMacDeviceId,
           let trustedMac = trustedMacRegistry.records[relayMacDeviceId] {
            secureConnectionState = .trustedMac
            secureMacFingerprint = constellagentSecureFingerprint(for: trustedMac.macIdentityPublicKey)
        } else if let trustedMac = currentTrustedMacRecord {
            secureConnectionState = .liveSessionUnresolved
            secureMacFingerprint = constellagentSecureFingerprint(for: trustedMac.macIdentityPublicKey)
        } else if normalizedRelaySessionId != nil {
            secureConnectionState = .notPaired
            secureMacFingerprint = nil
        } else {
            secureConnectionState = .notPaired
            secureMacFingerprint = nil
        }
    }

    // Used by: ContentViewModel trusted reconnect path.
    func resolveTrustedMacSession(deviceId: String? = nil) async throws -> ConstellagentTrustedSessionResolveResponse {
        let resolver = trustedSessionResolverOverride ?? { [weak self] in
            guard let self else {
                throw CancellationError()
            }
            return try await self.resolveTrustedMacSessionImpl(deviceId: deviceId)
        }
        let resolveTaskID = UUID()
        let task = Task {
            try await resolver()
        }

        trustedSessionResolveTask = task
        trustedSessionResolveTaskID = resolveTaskID
        defer {
            if trustedSessionResolveTaskID == resolveTaskID {
                trustedSessionResolveTask = nil
                trustedSessionResolveTaskID = nil
            }
        }

        return try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
    }

    // Lets manual reconnect / fresh QR pairing preempt a stuck trusted-session HTTP lookup.
    func cancelTrustedSessionResolve() {
        trustedSessionResolveTask?.cancel()
        trustedSessionResolveTask = nil
        trustedSessionResolveTaskID = nil
    }

    // Persists the resolved live relay session and resets replay cursors when the live session changed.
    func applyResolvedTrustedSession(_ resolved: ConstellagentTrustedSessionResolveResponse, relayURL: String) {
        let previousSessionId = normalizedRelaySessionId
        let shouldResetReplayCursor = previousSessionId == nil || previousSessionId != resolved.sessionId
        if shouldResetReplayCursor {
            SecureStore.writeString("0", for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq)
            lastAppliedBridgeOutboundSeq = 0
        }
        rememberResolvedTrustedSession(resolved, relayURL: relayURL)
    }

    // Resolves a short manual pairing code through the best-known relay for this app instance.
    func resolvePairingCode(_ code: String) async throws -> ConstellagentPairingQRPayload {
        let normalizedCode = code
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: " ", with: "")
        guard !normalizedCode.isEmpty else {
            throw ConstellagentSecureTransportError.invalidQR("Enter a valid pairing code.")
        }

        guard let relayURL = preferredPairingCodeRelayURL,
              let resolveURL = pairingCodeResolveURL(from: relayURL) else {
            throw ConstellagentSecureTransportError.invalidQR(
                "This iPhone does not know which relay to ask for that pairing code yet. Scan the QR code instead."
            )
        }

        try await requestLocalNetworkAuthorizationIfNeeded(for: resolveURL)

        var request = URLRequest(url: resolveURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": normalizedCode])

        let session = trustedSessionResolveURLSession(for: resolveURL)
        defer { session.invalidateAndCancel() }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw ConstellagentSecureTransportError.invalidQR("Could not reach the relay for this pairing code. Try again or scan the QR code.")
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ConstellagentSecureTransportError.invalidQR("The relay returned an invalid response for this pairing code.")
        }

        if (200..<300).contains(httpResponse.statusCode),
           let resolved = try? JSONDecoder().decode(ConstellagentPairingCodeResolveResponse.self, from: data),
           resolved.ok {
            return ConstellagentPairingQRPayload(
                v: resolved.v,
                relay: relayURL,
                sessionId: resolved.sessionId,
                macDeviceId: resolved.macDeviceId,
                macIdentityPublicKey: resolved.macIdentityPublicKey,
                expiresAt: resolved.expiresAt,
                displayName: resolved.displayName
            )
        }

        let errorResponse = try? JSONDecoder().decode(ConstellagentRelayErrorResponse.self, from: data)
        switch errorResponse?.code {
        case "pairing_code_expired":
            throw ConstellagentSecureTransportError.invalidQR("This pairing code has expired. Generate a new one from the device bridge.")
        case "pairing_code_unavailable":
            throw ConstellagentSecureTransportError.invalidQR("That pairing code is not available right now. Make sure your device bridge is running and try again.")
        default:
            if httpResponse.statusCode == 404 {
                throw ConstellagentSecureTransportError.invalidQR("This relay does not support pairing codes yet. Scan the QR code instead.")
            }
            throw ConstellagentSecureTransportError.invalidQR(
                errorResponse?.error ?? "The relay could not resolve that pairing code."
            )
        }
    }

#if DEBUG
    private static var debugAutoPairAttempted = false

    /// Dev-only: pair from launch args/env, or fetch the live code from the local desktop bridge.
    func debugAutoPairWithEnvironmentCodeIfPresent() async {
        guard !Self.debugAutoPairAttempted else {
            return
        }
        Self.debugAutoPairAttempted = true

        shouldAutoReconnectOnForeground = false
        connectionRecoveryState = .idle
        if isConnected || isConnecting {
            await disconnect()
        }

        guard let relayURL = preferredPairingCodeRelayURL,
              let statusURL = debugBridgeStatusURL(from: relayURL) else {
            print("[Constellagent][debug] auto-pair skipped: no relay URL configured")
            return
        }

        do {
            try await requestLocalNetworkAuthorizationIfNeeded(for: statusURL)
        } catch {
            lastErrorMessage = error.localizedDescription
            print("[Constellagent][debug] auto-pair local-network auth failed:", error.localizedDescription)
            return
        }

        let launchArgumentCode = ProcessInfo.processInfo.arguments
            .first(where: { $0.hasPrefix("--auto-pair-code=") })?
            .replacingOccurrences(of: "--auto-pair-code=", with: "")
        var raw = (
            ProcessInfo.processInfo.environment["CONSTELLAGENT_AUTO_PAIR_CODE"]
                ?? launchArgumentCode
        )?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if raw?.isEmpty ?? true {
            for attempt in 1...3 {
                raw = await fetchDebugBridgePairingCode(from: statusURL)
                if raw?.isEmpty == false {
                    break
                }
                if attempt < 3 {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                }
            }
        }

        guard let raw, !raw.isEmpty else {
            print("[Constellagent][debug] auto-pair skipped: could not fetch pairing code")
            return
        }

        do {
            let pairingPayload = try await resolvePairingCode(raw)
            rememberRelayPairing(pairingPayload)
            let fullURL = "\(pairingPayload.relay)/\(pairingPayload.sessionId)"
            var lastError: Error?
            for attempt in 1...4 {
                do {
                    try await connect(serverURL: fullURL, token: "", role: "iphone")
                    print("[Constellagent][debug] auto-pair succeeded for session", pairingPayload.sessionId)
                    return
                } catch {
                    lastError = error
                    print("[Constellagent][debug] auto-pair connect attempt \(attempt) failed:", error.localizedDescription)
                    if attempt < 4 {
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                    }
                }
            }
            if let lastError {
                throw lastError
            }
        } catch {
            lastErrorMessage = error.localizedDescription
            print("[Constellagent][debug] auto-pair failed:", error.localizedDescription)
        }
    }

    private func debugBridgeStatusURL(from relayURL: String) -> URL? {
        guard var components = URLComponents(string: relayURL) else {
            return nil
        }
        if components.scheme == "wss" {
            components.scheme = "https"
        } else if components.scheme == "ws" {
            components.scheme = "http"
        }
        components.path = "/mobile/status"
        return components.url
    }

    private func fetchDebugBridgePairingCode(from statusURL: URL) async -> String? {
        var request = URLRequest(url: statusURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 5

        let session = trustedSessionResolveURLSession(for: statusURL)
        defer { session.invalidateAndCancel() }

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let code = json["pairingCode"] as? String else {
                return nil
            }
            return code.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            return nil
        }
    }
#endif
}

extension ConstellagentService {
    func trustMac(
        deviceId: String,
        publicKey: String,
        relayURL: String?,
        displayName: String?,
        liveSessionId: String? = nil
    ) {
        let normalizedPublicKey = publicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDisplayName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedDisplayName = trimmedDisplayName?.isEmpty == false ? trimmedDisplayName : nil
        let trimmedLiveSessionId = liveSessionId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedLiveSessionId = trimmedLiveSessionId?.isEmpty == false ? trimmedLiveSessionId : nil
        let now = Date()
        let incomingDisplayNameKey = trustedMacDisplayNameCompactionKey(normalizedDisplayName)
        let staleDuplicateRecords = trustedMacRegistry.records.values
            .filter { trustedMac in
                guard trustedMac.macDeviceId != deviceId else {
                    return false
                }

                if hasSameTrustedMacIdentity(trustedMac, asPublicKey: normalizedPublicKey) {
                    return true
                }

                guard let incomingDisplayNameKey,
                      trustedMacDisplayNameCompactionKey(trustedMac.displayName) == incomingDisplayNameKey else {
                    return false
                }
                return shouldCoalesceTrustedMacRecordByDisplayName(
                    trustedMac,
                    incomingPublicKey: normalizedPublicKey,
                    now: now
                )
            }
            .sorted { shouldPreferTrustedMacRecord($0, over: $1) }
        let existing = preferredExistingTrustedMacRecord(
            current: trustedMacRegistry.records[deviceId],
            duplicates: staleDuplicateRecords
        )
        let existingHasSameIdentity = existing.map {
            hasSameTrustedMacIdentity($0, asPublicKey: normalizedPublicKey)
        } ?? false

        // Old bridge resets could rotate ids; collapse those historical records when a fresh QR proves the current one.
        let migratedScopedState = migrateMacScopedState(
            from: staleDuplicateRecords.map(\.macDeviceId),
            to: deviceId
        )
        for staleRecord in staleDuplicateRecords {
            trustedMacRegistry.records.removeValue(forKey: staleRecord.macDeviceId)
        }
        if let normalizedPreviousTrustedMacDeviceId,
           staleDuplicateRecords.contains(where: { $0.macDeviceId == normalizedPreviousTrustedMacDeviceId }) {
            clearPreviousTrustedMacDeviceId()
        }

        trustedMacRegistry.records[deviceId] = ConstellagentTrustedMacRecord(
            macDeviceId: deviceId,
            macIdentityPublicKey: normalizedPublicKey,
            lastPairedAt: now,
            relayURL: relayURL ?? existing?.relayURL,
            displayName: preferredTrustedMacDisplayName(
                incoming: normalizedDisplayName,
                existing: existing?.displayName
            ),
            lastResolvedSessionId: normalizedLiveSessionId
                ?? (existingHasSameIdentity ? existing?.lastResolvedSessionId : nil),
            lastResolvedAt: normalizedLiveSessionId == nil
                ? (existingHasSameIdentity ? existing?.lastResolvedAt : nil)
                : now,
            lastUsedAt: now
        )
        SecureStore.writeCodable(trustedMacRegistry, for: ConstellagentSecureKeys.trustedMacRegistry)
        setCurrentTrustedMacDeviceId(deviceId)
        if migratedScopedState {
            loadMacScopedDefaultsState(for: deviceId)
        }
        SecureStore.writeString(deviceId, for: ConstellagentSecureKeys.lastTrustedMacDeviceId)
        lastTrustedMacDeviceId = deviceId
        secureMacFingerprint = constellagentSecureFingerprint(for: normalizedPublicKey)
    }

    @discardableResult
    func pruneOfflineTrustedMacRecords(matching trustedMac: ConstellagentTrustedMacRecord) -> Int {
        let targetPublicKey = trustedMac.macIdentityPublicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let protectedDeviceIds = Set([
            normalizedCurrentTrustedMacDeviceId,
            normalizedRelayMacDeviceId,
        ].compactMap { $0 })
        let now = Date()

        let removableDeviceIds = trustedMacRegistry.records.values
            .filter { record in
                guard !protectedDeviceIds.contains(record.macDeviceId) else {
                    return false
                }
                guard isStaleTrustedMacDisplayDuplicate(record, now: now) else {
                    return false
                }

                if record.macDeviceId == trustedMac.macDeviceId {
                    return true
                }

                guard !targetPublicKey.isEmpty else {
                    return false
                }
                return record.macIdentityPublicKey.trimmingCharacters(in: .whitespacesAndNewlines) == targetPublicKey
            }
            .map(\.macDeviceId)

        guard !removableDeviceIds.isEmpty else {
            return 0
        }

        for deviceId in removableDeviceIds {
            trustedMacRegistry.records.removeValue(forKey: deviceId)
        }
        if let normalizedPreviousTrustedMacDeviceId,
           removableDeviceIds.contains(normalizedPreviousTrustedMacDeviceId) {
            clearPreviousTrustedMacDeviceId()
        }
        SecureStore.writeCodable(trustedMacRegistry, for: ConstellagentSecureKeys.trustedMacRegistry)
        return removableDeviceIds.count
    }

    func presentationTrustedMacRecords() -> [ConstellagentTrustedMacRecord] {
        let records = compactedTrustedMacRecords(Array(trustedMacRegistry.records.values))
        return hidingStaleGenericPresentationRecords(records)
    }

    private func preferredTrustedMacDisplayName(incoming: String?, existing: String?) -> String? {
        let normalizedIncoming = normalizedTrustedMacDisplayName(incoming)
        let normalizedExisting = normalizedTrustedMacDisplayName(existing)
        if let normalizedIncoming,
           isGenericTrustedMacDisplayName(normalizedIncoming),
           let normalizedExisting,
           !isGenericTrustedMacDisplayName(normalizedExisting) {
            return normalizedExisting
        }
        return normalizedIncoming ?? normalizedExisting
    }

    private func preferredExistingTrustedMacRecord(
        current: ConstellagentTrustedMacRecord?,
        duplicates: [ConstellagentTrustedMacRecord]
    ) -> ConstellagentTrustedMacRecord? {
        guard let current else {
            return duplicates.first
        }

        let candidates = ([current] + duplicates).sorted { shouldPreferTrustedMacRecord($0, over: $1) }
        if isGenericOrMissingTrustedMacDisplayName(current.displayName),
           let specificCandidate = candidates.first(where: { !isGenericOrMissingTrustedMacDisplayName($0.displayName) }) {
            return specificCandidate
        }

        return candidates.first ?? current
    }

    private func normalizedTrustedMacDisplayName(_ displayName: String?) -> String? {
        let trimmedDisplayName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedDisplayName?.isEmpty == false ? trimmedDisplayName : nil
    }

    private func isGenericTrustedMacDisplayName(_ displayName: String) -> Bool {
        displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            .caseInsensitiveCompare("Mac") == .orderedSame
    }

    private func isGenericOrMissingTrustedMacDisplayName(_ displayName: String?) -> Bool {
        guard let displayName = normalizedTrustedMacDisplayName(displayName) else {
            return true
        }
        return isGenericTrustedMacDisplayName(displayName)
    }

    // Keeps old bridge-era "Mac" placeholders out of the picker without deleting trust records.
    private func hidingStaleGenericPresentationRecords(_ records: [ConstellagentTrustedMacRecord]) -> [ConstellagentTrustedMacRecord] {
        let now = Date()
        guard records.contains(where: { !isStaleGenericPresentationRecord($0, now: now) }) else {
            return records
        }
        return records.filter { !isStaleGenericPresentationRecord($0, now: now) }
    }

    private func isStaleGenericPresentationRecord(_ trustedMac: ConstellagentTrustedMacRecord, now: Date) -> Bool {
        let protectedDeviceIds = Set([
            normalizedCurrentTrustedMacDeviceId,
            normalizedRelayMacDeviceId,
        ].compactMap { $0 })
        guard !protectedDeviceIds.contains(trustedMac.macDeviceId),
              isGenericOrMissingTrustedMacDisplayName(trustedMac.displayName),
              isStaleTrustedMacDisplayDuplicate(trustedMac, now: now) else {
            return false
        }

        return true
    }

    private func compactedTrustedMacRecords(_ records: [ConstellagentTrustedMacRecord]) -> [ConstellagentTrustedMacRecord] {
        var keyedRecords: [String: [ConstellagentTrustedMacRecord]] = [:]
        var unkeyedRecords: [ConstellagentTrustedMacRecord] = []

        for record in records {
            guard let key = trustedMacIdentityCompactionKey(for: record) else {
                unkeyedRecords.append(record)
                continue
            }
            keyedRecords[key, default: []].append(record)
        }

        let identityCompactedRecords = unkeyedRecords + keyedRecords.values.compactMap { records in
            records.sorted { shouldPreferTrustedMacRecord($0, over: $1) }.first
        }
        let sortedRecords = identityCompactedRecords.sorted { shouldPreferTrustedMacRecord($0, over: $1) }
        var selectedRecords: [ConstellagentTrustedMacRecord] = []
        var selectedDisplayNameKeys = Set<String>()
        let now = Date()

        for record in sortedRecords {
            let displayNameKey = trustedMacDisplayNameCompactionKey(record.displayName)
            if let displayNameKey,
               selectedDisplayNameKeys.contains(displayNameKey),
               isStaleTrustedMacDisplayDuplicate(record, now: now) {
                continue
            }

            selectedRecords.append(record)
            if let displayNameKey {
                selectedDisplayNameKeys.insert(displayNameKey)
            }
        }

        return selectedRecords
    }

    private func shouldPreferTrustedMacRecord(
        _ lhs: ConstellagentTrustedMacRecord,
        over rhs: ConstellagentTrustedMacRecord
    ) -> Bool {
        let lhsRank = trustedMacCompactionRank(lhs)
        let rhsRank = trustedMacCompactionRank(rhs)
        if lhsRank != rhsRank {
            return lhsRank > rhsRank
        }

        let lhsDate = trustedMacActivityDate(lhs)
        let rhsDate = trustedMacActivityDate(rhs)
        if lhsDate != rhsDate {
            return lhsDate > rhsDate
        }

        let lhsHasResolvedSession = hasResolvedTrustedMacSession(lhs)
        let rhsHasResolvedSession = hasResolvedTrustedMacSession(rhs)
        if lhsHasResolvedSession != rhsHasResolvedSession {
            return lhsHasResolvedSession
        }

        return lhs.macDeviceId < rhs.macDeviceId
    }

    private func trustedMacCompactionRank(_ trustedMac: ConstellagentTrustedMacRecord) -> Int {
        if trustedMac.macDeviceId == normalizedCurrentTrustedMacDeviceId {
            return 500
        }
        if trustedMac.macDeviceId == normalizedRelayMacDeviceId {
            return 450
        }
        if trustedMac.macDeviceId == normalizedPreviousTrustedMacDeviceId {
            return 400
        }
        return 0
    }

    private func hasResolvedTrustedMacSession(_ trustedMac: ConstellagentTrustedMacRecord) -> Bool {
        if trustedMac.lastResolvedAt != nil {
            return true
        }
        return trustedMac.lastResolvedSessionId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private func trustedMacActivityDate(_ trustedMac: ConstellagentTrustedMacRecord) -> Date {
        trustedMac.lastResolvedAt ?? trustedMac.lastUsedAt ?? trustedMac.lastPairedAt
    }

    private func trustedMacIdentityCompactionKey(for trustedMac: ConstellagentTrustedMacRecord) -> String? {
        let normalizedPublicKey = trustedMac.macIdentityPublicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedPublicKey.isEmpty else {
            return nil
        }
        return "key:\(normalizedPublicKey)"
    }

    private func trustedMacDisplayNameCompactionKey(_ displayName: String?) -> String? {
        if let displayName = normalizedTrustedMacDisplayName(displayName),
           !isGenericTrustedMacDisplayName(displayName) {
            return "name:\(displayName.lowercased())"
        }

        return nil
    }

    private func hasSameTrustedMacIdentity(_ trustedMac: ConstellagentTrustedMacRecord, asPublicKey publicKey: String) -> Bool {
        let normalizedPublicKey = publicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedPublicKey.isEmpty else {
            return false
        }

        return trustedMac.macIdentityPublicKey.trimmingCharacters(in: .whitespacesAndNewlines) == normalizedPublicKey
    }

    private func shouldCoalesceTrustedMacRecordByDisplayName(
        _ trustedMac: ConstellagentTrustedMacRecord,
        incomingPublicKey: String,
        now: Date
    ) -> Bool {
        guard !incomingPublicKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }

        return isStaleTrustedMacDisplayDuplicate(trustedMac, now: now)
    }

    private func isStaleTrustedMacDisplayDuplicate(_ trustedMac: ConstellagentTrustedMacRecord, now: Date) -> Bool {
        guard !isProtectedTrustedMacRecord(trustedMac) else {
            return false
        }

        return now.timeIntervalSince(trustedMacActivityDate(trustedMac)) > TimeInterval(24 * 60 * 60)
    }

    private func isProtectedTrustedMacRecord(_ trustedMac: ConstellagentTrustedMacRecord) -> Bool {
        let protectedDeviceIds = Set([
            normalizedCurrentTrustedMacDeviceId,
            normalizedRelayMacDeviceId,
            normalizedPreviousTrustedMacDeviceId,
        ].compactMap { $0 })
        return protectedDeviceIds.contains(trustedMac.macDeviceId)
    }
}

enum ConstellagentTrustedSessionResolveURLBuilder {
    // Builds both proxy-relative and root HTTP resolve routes from the remembered WebSocket relay URL.
    static func candidates(from relayURL: String) -> [URL] {
        guard var components = URLComponents(string: relayURL) else {
            return []
        }

        normalizeRelayResolveComponents(&components)

        var candidates: [URL] = []
        let pathComponents = components.path.split(separator: "/").map(String.init)
        if pathComponents.last == "relay" {
            let prefix = pathComponents.dropLast()
            components.path = "/" + (prefix + ["v1", "trusted", "session", "resolve"]).joined(separator: "/")
        } else {
            components.path = "/v1/trusted/session/resolve"
        }
        if let url = components.url {
            candidates.append(url)
        }

        if var rootComponents = URLComponents(string: relayURL) {
            normalizeRelayResolveComponents(&rootComponents)
            rootComponents.path = "/v1/trusted/session/resolve"
            if let rootURL = rootComponents.url,
               !candidates.contains(where: { $0.absoluteString == rootURL.absoluteString }) {
                candidates.append(rootURL)
            }
        }

        return candidates
    }

    private static func normalizeRelayResolveComponents(_ components: inout URLComponents) {
        if components.scheme == "wss" {
            components.scheme = "https"
        } else if components.scheme == "ws" {
            components.scheme = "http"
        }
        components.query = nil
        components.fragment = nil
    }
}

private extension ConstellagentService {
    // Centralizes the bridge-update guidance so every mismatch shows the same Mac command.
    func presentBridgeUpdatePrompt(message: String) {
        bridgeUpdatePrompt = ConstellagentBridgeUpdatePrompt(
            title: "Update the Constellagent package on your device",
            message: message,
            command: "npm install -g constellagent@latest"
        )
    }

    func sendWireControlMessage<Value: Encodable>(_ value: Value) async throws {
        let data = try JSONEncoder().encode(value)
        guard let text = String(data: data, encoding: .utf8) else {
            throw ConstellagentSecureTransportError.invalidHandshake("Unable to encode the secure Constellagent control payload.")
        }
        try await sendRawText(text)
    }

    func waitForSecureControlMessage(kind: String, timeoutSeconds: TimeInterval = 12) async throws -> String {
        if let bufferedSecureError = bufferedSecureControlMessages["secureError"]?.first,
           let secureError = try? decodeSecureControl(SecureErrorMessage.self, from: bufferedSecureError) {
            bufferedSecureControlMessages["secureError"] = []
            throw ConstellagentSecureTransportError.secureError(secureError.message)
        }

        if var buffered = bufferedSecureControlMessages[kind], !buffered.isEmpty {
            let first = buffered.removeFirst()
            bufferedSecureControlMessages[kind] = buffered
            return first
        }

        let waiterID = UUID()
        let timeoutMessage = "Timed out waiting for the secure Constellagent \(kind) message."

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            pendingSecureControlContinuations[kind, default: []].append(
                ConstellagentSecureControlWaiter(id: waiterID, continuation: continuation)
            )

            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
                guard let self else { return }
                self.resumePendingSecureControlWaiterIfNeeded(
                    kind: kind,
                    waiterID: waiterID,
                    result: .failure(ConstellagentSecureTransportError.timedOut(timeoutMessage))
                )
            }
        }
    }

    func bufferSecureControlMessage(kind: String, rawText: String) {
        if kind == "secureError",
           let secureError = try? decodeSecureControl(SecureErrorMessage.self, from: rawText) {
            lastErrorMessage = secureError.message
            if secureError.code == "update_required" {
                secureConnectionState = .updateRequired
                presentBridgeUpdatePrompt(message: secureError.message)
            } else if secureError.code == "pairing_expired"
                || secureError.code == "phone_not_trusted"
                || secureError.code == "phone_identity_changed"
                || secureError.code == "phone_replacement_required" {
                secureConnectionState = .rePairRequired
            }

            let continuations = pendingSecureControlContinuations
            pendingSecureControlContinuations.removeAll()
            bufferedSecureControlMessages.removeAll()
            for waiters in continuations.values {
                for waiter in waiters {
                    waiter.continuation.resume(throwing: ConstellagentSecureTransportError.secureError(secureError.message))
                }
            }
            if continuations.isEmpty {
                bufferedSecureControlMessages["secureError"] = [rawText]
            }
            return
        }

        if var waiters = pendingSecureControlContinuations[kind], !waiters.isEmpty {
            let waiter = waiters.removeFirst()
            if waiters.isEmpty {
                pendingSecureControlContinuations.removeValue(forKey: kind)
            } else {
                pendingSecureControlContinuations[kind] = waiters
            }
            waiter.continuation.resume(returning: rawText)
            return
        }

        bufferedSecureControlMessages[kind, default: []].append(rawText)
    }

    // Resumes a specific secure-control waiter once, so timeout tasks cannot double-resume it.
    func resumePendingSecureControlWaiterIfNeeded(
        kind: String,
        waiterID: UUID,
        result: Result<String, Error>
    ) {
        guard var waiters = pendingSecureControlContinuations[kind],
              let waiterIndex = waiters.firstIndex(where: { $0.id == waiterID }) else {
            return
        }

        let waiter = waiters.remove(at: waiterIndex)
        if waiters.isEmpty {
            pendingSecureControlContinuations.removeValue(forKey: kind)
        } else {
            pendingSecureControlContinuations[kind] = waiters
        }
        waiter.continuation.resume(with: result)
    }

    func handleEncryptedEnvelopeText(_ text: String) {
        // No active session yet (handshake in progress) — silently drop stale envelopes.
        guard var secureSession else { return }

        guard let envelope = try? decodeSecureControl(SecureEnvelope.self, from: text),
              envelope.sessionId == secureSession.sessionId,
              envelope.keyEpoch == secureSession.keyEpoch,
              envelope.sender == "mac",
              envelope.counter > secureSession.lastInboundCounter else {
            lastErrorMessage = "The secure Constellagent payload could not be verified."
            secureConnectionState = .rePairRequired
            return
        }

        do {
            let nonce = try AES.GCM.Nonce(
                data: constellagentSecureNonce(sender: envelope.sender, counter: envelope.counter)
            )
            let sealedBox = try AES.GCM.SealedBox(
                nonce: nonce,
                ciphertext: Data(base64EncodedOrEmpty: envelope.ciphertext),
                tag: Data(base64EncodedOrEmpty: envelope.tag)
            )
            let plaintext = try AES.GCM.open(sealedBox, using: secureSession.macToPhoneKey)
            let payload = try JSONDecoder().decode(SecureApplicationPayload.self, from: plaintext)
            secureSession.lastInboundCounter = envelope.counter
            self.secureSession = secureSession

            if let bridgeOutboundSeq = payload.bridgeOutboundSeq {
                if bridgeOutboundSeq <= lastAppliedBridgeOutboundSeq {
                    return
                }
                lastAppliedBridgeOutboundSeq = bridgeOutboundSeq
                SecureStore.writeString(
                    String(bridgeOutboundSeq),
                    for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq
                )
            }

            lastRawMessage = payload.payloadText
            processIncomingText(payload.payloadText)
        } catch {
            lastErrorMessage = ConstellagentSecureTransportError.decryptFailed.localizedDescription
            secureConnectionState = .rePairRequired
        }
    }

    // Resolves the live relay session for the preferred trusted Mac before we reconnect the socket.
    func resolveTrustedMacSessionImpl(deviceId: String? = nil) async throws -> ConstellagentTrustedSessionResolveResponse {
        guard let trustedMac = trustedMacRecord(for: deviceId) ?? currentTrustedMacRecord else {
            throw ConstellagentTrustedSessionResolveError.noTrustedMac
        }
        guard let relayURL = trustedMac.relayURL?.trimmingCharacters(in: .whitespacesAndNewlines),
              !relayURL.isEmpty else {
            throw ConstellagentTrustedSessionResolveError.noTrustedMac
        }
        let resolveURLs = ConstellagentTrustedSessionResolveURLBuilder.candidates(from: relayURL)
        guard !resolveURLs.isEmpty else {
            throw ConstellagentTrustedSessionResolveError.invalidResponse("The trusted device relay URL is invalid.")
        }

        var lastRetriableResolveError: ConstellagentTrustedSessionResolveError?
        for (index, resolveURL) in resolveURLs.enumerated() {
            do {
                return try await sendTrustedSessionResolveRequest(
                    makeTrustedSessionResolveRequestBody(for: trustedMac),
                    trustedMac: trustedMac,
                    resolveURL: resolveURL,
                    relayURL: relayURL
                )
            } catch let error as ConstellagentTrustedSessionResolveError {
                guard shouldTryNextTrustedResolveCandidate(after: error),
                      index < resolveURLs.count - 1 else {
                    throw error
                }
                lastRetriableResolveError = error
                continue
            }
        }

        throw lastRetriableResolveError ?? ConstellagentTrustedSessionResolveError.unsupportedRelay
    }

    private func makeTrustedSessionResolveRequestBody(
        for trustedMac: ConstellagentTrustedMacRecord
    ) throws -> ConstellagentTrustedSessionResolveRequest {
        let nonce = UUID().uuidString
        let timestamp = Int64(Date().timeIntervalSince1970 * 1_000)
        let transcriptBytes = constellagentTrustedSessionResolveTranscriptBytes(
            macDeviceId: trustedMac.macDeviceId,
            phoneDeviceId: phoneIdentityState.phoneDeviceId,
            phoneIdentityPublicKey: phoneIdentityState.phoneIdentityPublicKey,
            nonce: nonce,
            timestamp: timestamp
        )
        let phonePrivateKey = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(base64EncodedOrEmpty: phoneIdentityState.phoneIdentityPrivateKey)
        )
        let signature = try phonePrivateKey.signature(for: transcriptBytes).base64EncodedString()

        return ConstellagentTrustedSessionResolveRequest(
            macDeviceId: trustedMac.macDeviceId,
            phoneDeviceId: phoneIdentityState.phoneDeviceId,
            phoneIdentityPublicKey: phoneIdentityState.phoneIdentityPublicKey,
            nonce: nonce,
            timestamp: timestamp,
            signature: signature
        )
    }

    private func shouldTryNextTrustedResolveCandidate(after error: ConstellagentTrustedSessionResolveError) -> Bool {
        switch error {
        case .unsupportedRelay, .invalidResponse, .network:
            return true
        case .macOffline, .rePairRequired, .noTrustedMac:
            return false
        }
    }

    private func sendTrustedSessionResolveRequest(
        _ requestBody: ConstellagentTrustedSessionResolveRequest,
        trustedMac: ConstellagentTrustedMacRecord,
        resolveURL: URL,
        relayURL: String
    ) async throws -> ConstellagentTrustedSessionResolveResponse {
        var request = URLRequest(url: resolveURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let session = trustedSessionResolveURLSession(for: resolveURL)
        defer { session.invalidateAndCancel() }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            let nsError = error as NSError
            if Task.isCancelled
                || (nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled) {
                throw CancellationError()
            }
            throw ConstellagentTrustedSessionResolveError.network("Could not reach the trusted device relay. Check your connection and try again.")
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ConstellagentTrustedSessionResolveError.invalidResponse("The trusted device relay returned an invalid response.")
        }

        if (200..<300).contains(httpResponse.statusCode) {
            guard let resolved = try? JSONDecoder().decode(ConstellagentTrustedSessionResolveResponse.self, from: data),
                  resolved.ok else {
                throw ConstellagentTrustedSessionResolveError.invalidResponse("The trusted device relay returned malformed session data.")
            }
            try validateResolvedTrustedSession(resolved, for: trustedMac)
            applyResolvedTrustedSession(resolved, relayURL: relayURL)
            return resolved
        }

        let errorResponse = try? JSONDecoder().decode(ConstellagentRelayErrorResponse.self, from: data)
        switch errorResponse?.code {
        case "session_unavailable":
            secureConnectionState = .liveSessionUnresolved
            throw ConstellagentTrustedSessionResolveError.macOffline("Your trusted device is offline right now.")
        case "phone_not_trusted", "invalid_signature":
            secureConnectionState = .rePairRequired
            throw ConstellagentTrustedSessionResolveError.rePairRequired(
                "This iPhone is no longer trusted by the paired device. Scan a new QR code to reconnect."
            )
        case "resolve_request_replayed", "resolve_request_expired":
            throw ConstellagentTrustedSessionResolveError.network(
                "The trusted reconnect request expired. Try reconnecting again."
            )
        default:
            if httpResponse.statusCode == 404 {
                throw ConstellagentTrustedSessionResolveError.unsupportedRelay
            }
            throw ConstellagentTrustedSessionResolveError.network(
                errorResponse?.error
                ?? "The trusted device relay could not resolve the current bridge session."
            )
        }
    }

    // Refuses relay bugs or stale indexes that point a switch at a different Mac than requested.
    private func validateResolvedTrustedSession(
        _ resolved: ConstellagentTrustedSessionResolveResponse,
        for trustedMac: ConstellagentTrustedMacRecord
    ) throws {
        guard resolved.macDeviceId == trustedMac.macDeviceId else {
            throw ConstellagentTrustedSessionResolveError.invalidResponse(
                "The trusted device relay returned a session for a different device."
            )
        }

        let resolvedPublicKey = resolved.macIdentityPublicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trustedPublicKey = trustedMac.macIdentityPublicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !resolvedPublicKey.isEmpty, resolvedPublicKey == trustedPublicKey else {
            throw ConstellagentTrustedSessionResolveError.invalidResponse(
                "The trusted device relay returned a different device identity key."
            )
        }
    }

    private func rememberResolvedTrustedSession(_ resolved: ConstellagentTrustedSessionResolveResponse, relayURL: String) {
        SecureStore.writeString(resolved.sessionId, for: ConstellagentSecureKeys.relaySessionId)
        SecureStore.writeString(relayURL, for: ConstellagentSecureKeys.relayUrl)
        SecureStore.writeString(resolved.macDeviceId, for: ConstellagentSecureKeys.relayMacDeviceId)
        SecureStore.writeString(resolved.macIdentityPublicKey, for: ConstellagentSecureKeys.relayMacIdentityPublicKey)
        SecureStore.writeString(String(constellagentSecureProtocolVersion), for: ConstellagentSecureKeys.relayProtocolVersion)
        relaySessionId = resolved.sessionId
        relayUrl = relayURL
        relayMacDeviceId = resolved.macDeviceId
        relayMacIdentityPublicKey = resolved.macIdentityPublicKey
        relayProtocolVersion = constellagentSecureProtocolVersion
        shouldForceQRBootstrapOnNextHandshake = false
        trustedReconnectFailureCount = 0
        secureConnectionState = .trustedMac
        secureMacFingerprint = constellagentSecureFingerprint(for: resolved.macIdentityPublicKey)
        if normalizedCurrentTrustedMacDeviceId == nil
            || normalizedCurrentTrustedMacDeviceId == resolved.macDeviceId {
            setCurrentTrustedMacDeviceId(resolved.macDeviceId)
        }
        SecureStore.writeString(resolved.macDeviceId, for: ConstellagentSecureKeys.lastTrustedMacDeviceId)
        lastTrustedMacDeviceId = resolved.macDeviceId

        if var trustedMac = trustedMacRegistry.records[resolved.macDeviceId] {
            trustedMac.relayURL = relayURL
            trustedMac.displayName = resolved.displayName ?? trustedMac.displayName
            trustedMac.lastResolvedSessionId = resolved.sessionId
            trustedMac.lastResolvedAt = Date()
            trustedMac.lastUsedAt = Date()
            trustedMacRegistry.records[resolved.macDeviceId] = trustedMac
            SecureStore.writeCodable(trustedMacRegistry, for: ConstellagentSecureKeys.trustedMacRegistry)
        }
    }

    private var preferredPairingCodeRelayURL: String? {
        if let normalizedRelayURL {
            return normalizedRelayURL
        }
        if let trustedRelayURL = preferredTrustedMacRecord?.relayURL?.trimmingCharacters(in: .whitespacesAndNewlines),
           !trustedRelayURL.isEmpty {
            return trustedRelayURL
        }
        let defaultRelayURL = AppEnvironment.relayBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        return defaultRelayURL.isEmpty ? nil : defaultRelayURL
    }

    private func pairingCodeResolveURL(from relayURL: String) -> URL? {
        guard var components = URLComponents(string: relayURL) else {
            return nil
        }

        if components.scheme == "wss" {
            components.scheme = "https"
        } else if components.scheme == "ws" {
            components.scheme = "http"
        }

        let pathComponents = components.path.split(separator: "/").map(String.init)
        if pathComponents.last == "relay" {
            let prefix = pathComponents.dropLast()
            components.path = "/" + (prefix + ["v1", "pairing", "code", "resolve"]).joined(separator: "/")
        } else {
            components.path = "/v1/pairing/code/resolve"
        }

        return components.url
    }

    // Uses a non-proxying URLSession for local/private-overlay relays so trusted reconnect
    // avoids the same iOS proxy path that can break direct websocket pairing.
    private func trustedSessionResolveURLSession(for url: URL) -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.allowsCellularAccess = true
        configuration.allowsConstrainedNetworkAccess = true
        configuration.allowsExpensiveNetworkAccess = true

        if prefersDirectRelayTransport(for: url) {
            configuration.connectionProxyDictionary = [:]
        }

        return URLSession(configuration: configuration)
    }

    /// Waits for a serverHello whose echoed clientNonce matches the one we sent.
    /// Stale serverHellos from a previous handshake attempt (e.g. buffered by the relay
    /// across a phone disconnect/reconnect) are silently discarded until the correct one
    /// arrives or the per-message 12-second timeout fires.
    func waitForMatchingServerHello(
        expectedSessionId: String,
        expectedMacDeviceId: String,
        expectedMacIdentityPublicKey: String,
        expectedClientNonce: String,
        clientNonce: Data,
        phoneDeviceId: String,
        phoneIdentityPublicKey: String,
        phoneEphemeralPublicKey: String
    ) async throws -> SecureServerHello {
        while true {
            let raw = try await waitForSecureControlMessage(kind: "serverHello")
            let hello = try decodeSecureControl(SecureServerHello.self, from: raw)
            if let echoedNonce = hello.clientNonce, echoedNonce != expectedClientNonce {
                debugSecureLog("discarding stale serverHello (clientNonce mismatch)")
                continue
            }
            if hello.clientNonce == nil,
               !isMatchingLegacyServerHello(
                    hello,
                    expectedSessionId: expectedSessionId,
                    expectedMacDeviceId: expectedMacDeviceId,
                    expectedMacIdentityPublicKey: expectedMacIdentityPublicKey,
                    clientNonce: clientNonce,
                    phoneDeviceId: phoneDeviceId,
                    phoneIdentityPublicKey: phoneIdentityPublicKey,
                    phoneEphemeralPublicKey: phoneEphemeralPublicKey
               ) {
                debugSecureLog("discarding stale serverHello (legacy signature mismatch)")
                continue
            }
            return hello
        }
    }

    // Falls back to transcript-signature matching for pre-echo serverHello payloads.
    func isMatchingLegacyServerHello(
        _ hello: SecureServerHello,
        expectedSessionId: String,
        expectedMacDeviceId: String,
        expectedMacIdentityPublicKey: String,
        clientNonce: Data,
        phoneDeviceId: String,
        phoneIdentityPublicKey: String,
        phoneEphemeralPublicKey: String
    ) -> Bool {
        guard hello.protocolVersion == constellagentSecureProtocolVersion,
              hello.sessionId == expectedSessionId,
              hello.macDeviceId == expectedMacDeviceId,
              hello.macIdentityPublicKey == expectedMacIdentityPublicKey,
              let macPublicKey = try? Curve25519.Signing.PublicKey(
                  rawRepresentation: Data(base64EncodedOrEmpty: hello.macIdentityPublicKey)
              ) else {
            return false
        }

        let transcriptBytes = constellagentSecureTranscriptBytes(
            sessionId: expectedSessionId,
            protocolVersion: hello.protocolVersion,
            handshakeMode: hello.handshakeMode,
            keyEpoch: hello.keyEpoch,
            macDeviceId: hello.macDeviceId,
            phoneDeviceId: phoneDeviceId,
            macIdentityPublicKey: hello.macIdentityPublicKey,
            phoneIdentityPublicKey: phoneIdentityPublicKey,
            macEphemeralPublicKey: hello.macEphemeralPublicKey,
            phoneEphemeralPublicKey: phoneEphemeralPublicKey,
            clientNonce: clientNonce,
            serverNonce: Data(base64EncodedOrEmpty: hello.serverNonce),
            expiresAtForTranscript: hello.expiresAtForTranscript
        )
        return macPublicKey.isValidSignature(
            Data(base64EncodedOrEmpty: hello.macSignature),
            for: transcriptBytes
        )
    }

    /// Waits for a secureReady whose keyEpoch matches the current handshake.
    /// Stale secureReady messages from previous sessions are discarded until the
    /// correct one arrives or the per-message 12-second timeout fires.
    func waitForMatchingSecureReady(
        expectedSessionId: String,
        expectedKeyEpoch: Int,
        expectedMacDeviceId: String
    ) async throws -> SecureReadyMessage {
        while true {
            let raw = try await waitForSecureControlMessage(kind: "secureReady")
            let ready = try decodeSecureControl(SecureReadyMessage.self, from: raw)
            if ready.sessionId == expectedSessionId,
               ready.keyEpoch == expectedKeyEpoch,
               ready.macDeviceId == expectedMacDeviceId {
                return ready
            }
            debugSecureLog("discarding stale secureReady (keyEpoch=\(ready.keyEpoch) expected=\(expectedKeyEpoch))")
        }
    }

    func wireMessageKind(from rawText: String) -> String? {
        guard let data = rawText.data(using: .utf8),
              let json = try? JSONDecoder().decode(JSONValue.self, from: data),
              let object = json.objectValue else {
            return nil
        }
        return object["kind"]?.stringValue
    }

    func decodeSecureControl<Value: Decodable>(_ type: Value.Type, from rawText: String) throws -> Value {
        guard let data = rawText.data(using: .utf8) else {
            throw ConstellagentSecureTransportError.invalidHandshake("The secure control payload was not valid UTF-8.")
        }
        return try JSONDecoder().decode(type, from: data)
    }

    func randomSecureNonce() -> Data {
        var data = Data(repeating: 0, count: 32)
        _ = data.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        return data
    }

    func debugSecureLog(_ message: String) {
        print("[ConstellagentSecure] \(message)")
    }

    func shortSecureId(_ value: String) -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            return "none"
        }
        return shortTranscriptDigest(Data(normalized.utf8)).prefix(8).description
    }

    func shortSecureFingerprint(_ publicKeyBase64: String) -> String {
        let bytes = Data(base64EncodedOrEmpty: publicKeyBase64)
        guard !bytes.isEmpty else {
            return "invalid"
        }
        return shortTranscriptDigest(bytes)
    }

    func shortTranscriptDigest(_ data: Data) -> String {
        SHA256.hash(data: data).compactMap { String(format: "%02x", $0) }.joined().prefix(16).description
    }
}
