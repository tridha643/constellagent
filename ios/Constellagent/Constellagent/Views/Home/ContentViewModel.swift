// FILE: ContentViewModel.swift
// Purpose: Owns non-visual orchestration logic for the root screen (connection, relay pairing, sync throttling).
// Layer: ViewModel
// Exports: ContentViewModel
// Depends on: CryptoKit, Foundation, Observation, ConstellagentService, SecureStore

import CryptoKit
import Foundation
import Observation

@MainActor
@Observable
final class ContentViewModel {
    private var hasAttemptedInitialAutoConnect = false
    private var lastSidebarOpenSyncAt: Date = .distantPast
    private let autoReconnectBackoffNanoseconds: [UInt64] = [1_000_000_000, 3_000_000_000]
    private let launchReconnectAttemptLimit = 10
    private let reconnectSleepChunkNanoseconds: UInt64 = 100_000_000
    private(set) var isRunningAutoReconnect = false
    private(set) var isRunningManualReconnect = false
    private(set) var isSwitchingMac = false
    private(set) var isCancellingMacSwitch = false
    private(set) var switchingMacDeviceId: String?
    private(set) var macSwitchNotice: String?
    private var shouldCancelManualReconnect = false
    private let macSwitchInterruptTimeoutNanoseconds: UInt64 = 1_500_000_000
    // Test hooks keep reconnect verification fast without changing production retry behavior.
    @ObservationIgnored var reconnectAttemptLimitOverride: Int?
    @ObservationIgnored var launchReconnectAttemptLimitOverride: Int?
    @ObservationIgnored var connectOverride: ((ConstellagentService, String) async throws -> Void)?
    @ObservationIgnored var reconnectSleepOverride: ((UInt64) async -> Void)?
    @ObservationIgnored var reconnectSleepChunkNanosecondsOverride: UInt64?

    private struct RelaySessionSnapshot {
        let relaySessionId: String?
        let relayUrl: String?
        let relayMacDeviceId: String?
        let relayMacIdentityPublicKey: String?
        let relayProtocolVersion: Int
        let lastAppliedBridgeOutboundSeq: Int
        let shouldForceQRBootstrapOnNextHandshake: Bool
        let trustedReconnectFailureCount: Int
        let secureConnectionState: ConstellagentSecureConnectionState
        let secureMacFingerprint: String?
    }

    var isAttemptingAutoReconnect: Bool {
        isRunningAutoReconnect
    }

    var isAttemptingManualReconnect: Bool {
        isRunningManualReconnect
    }

    // Throttles sidebar-open sync requests to avoid redundant thread refresh churn.
    func shouldRequestSidebarFreshSync(isConnected: Bool) -> Bool {
        guard isConnected else {
            return false
        }

        let now = Date()
        guard now.timeIntervalSince(lastSidebarOpenSyncAt) >= 0.8 else {
            return false
        }

        lastSidebarOpenSyncAt = now
        return true
    }

    // Connects to the relay WebSocket using a scanned QR code payload.
    func connectToRelay(pairingPayload: ConstellagentPairingQRPayload, constellagent: ConstellagentService) async {
        await stopAutoReconnectForManualScan(constellagent: constellagent)
        // Avoid logging live pairing metadata; the relay URL path includes a bearer-like session id.
        let fullURL = "\(pairingPayload.relay)/\(pairingPayload.sessionId)"
        constellagent.rememberRelayPairing(pairingPayload)

        do {
            try await connectWithAutoRecovery(
                constellagent: constellagent,
                performAutoRetry: true,
                serverURLProvider: { fullURL }
            )
        } catch {
            if constellagent.lastErrorMessage?.isEmpty ?? true {
                constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(error)
            }
        }
    }

    // Connects or disconnects the relay.
    func toggleConnection(constellagent: ConstellagentService) async {
        if constellagent.isConnected {
            await constellagent.disconnect()
            constellagent.clearSavedRelaySession()
            return
        }

        guard !isRunningManualReconnect else {
            return
        }

        // Flips the UI into an immediate busy state before the reconnect handoff reaches the socket layer.
        shouldCancelManualReconnect = false
        isRunningManualReconnect = true
        defer { isRunningManualReconnect = false }

        await stopAutoReconnectForManualRetry(constellagent: constellagent)

        guard shouldContinueManualReconnect else {
            constellagent.connectionRecoveryState = .idle
            return
        }
        do {
            try await connectWithAutoRecovery(
                constellagent: constellagent,
                performAutoRetry: true,
                continueWhile: { self.shouldContinueManualReconnect },
                serverURLProvider: { await self.preferredReconnectURL(constellagent: constellagent) }
            )
        } catch {
            if isCancellationLikeError(error) {
                return
            }
            if constellagent.lastErrorMessage?.isEmpty ?? true {
                constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(error)
            }
        }
    }

    // Lets a manual reconnect tap interrupt a stuck foreground recovery loop.
    func stopAutoReconnectForManualRetry(constellagent: ConstellagentService) async {
        guard isRunningAutoReconnect || constellagent.isConnecting || constellagent.shouldAutoReconnectOnForeground else {
            return
        }

        constellagent.shouldAutoReconnectOnForeground = false
        constellagent.connectionRecoveryState = .retrying(attempt: 0, message: "Preparing reconnect...")
        constellagent.lastErrorMessage = nil
        constellagent.cancelTrustedSessionResolve()

        if constellagent.isConnecting || constellagent.isConnected {
            await constellagent.disconnect()
        }

        while isRunningAutoReconnect || constellagent.isConnecting {
            await sleepForReconnectBackoff(100_000_000)
        }
    }

    // Lets the manual QR flow take over instead of competing with the foreground reconnect loop.
    func stopAutoReconnectForManualScan(constellagent: ConstellagentService) async {
        shouldCancelManualReconnect = true
        constellagent.shouldAutoReconnectOnForeground = false
        constellagent.connectionRecoveryState = .idle
        constellagent.lastErrorMessage = nil
        constellagent.cancelTrustedSessionResolve()

        // Cancel any in-flight reconnect so the scanner can appear immediately instead of waiting
        // for a stalled handshake to time out on its own.
        if constellagent.isConnecting || constellagent.isConnected {
            await constellagent.disconnect()
        }

        while isRunningManualReconnect || isRunningAutoReconnect || constellagent.isConnecting {
            await sleepForReconnectBackoff(100_000_000)
        }
    }

    // Attempts one automatic connection on app launch using saved relay session.
    func attemptAutoConnectOnLaunchIfNeeded(constellagent: ConstellagentService) async {
        guard !hasAttemptedInitialAutoConnect else {
            return
        }
        hasAttemptedInitialAutoConnect = true

#if DEBUG
        if !AppEnvironment.relayBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return
        }
#endif

        guard !constellagent.isConnected, !constellagent.isConnecting else {
            return
        }

        guard constellagent.hasReconnectCandidate else {
            return
        }

        // Cold launches after device sleep often start before the bridge has re-registered
        // its fresh relay session, so use the foreground recovery loop instead of one short attempt.
        constellagent.shouldAutoReconnectOnForeground = true
        await attemptAutoReconnectOnForegroundIfNeeded(
            constellagent: constellagent,
            maxAttempts: launchReconnectAttemptLimitOverride ?? launchReconnectAttemptLimit
        )
    }

    // Reconnects after benign background disconnects.
    func attemptAutoReconnectOnForegroundIfNeeded(constellagent: ConstellagentService) async {
        await attemptAutoReconnectOnForegroundIfNeeded(
            constellagent: constellagent,
            maxAttempts: reconnectAttemptLimitOverride ?? 50
        )
    }

    // Reconnects after wake/cold-launch while allowing trusted session resolve to become live.
    private func attemptAutoReconnectOnForegroundIfNeeded(
        constellagent: ConstellagentService,
        maxAttempts: Int
    ) async {
        guard constellagent.shouldAutoReconnectOnForeground, !isRunningAutoReconnect else {
            return
        }

        isRunningAutoReconnect = true
        defer { isRunningAutoReconnect = false }

        var attempt = 0

        // Keep retryable reconnects alive until the socket recovers or the pairing becomes invalid.
        while constellagent.shouldAutoReconnectOnForeground, attempt < maxAttempts {

            let reconnectResolution = await autoRecoveryReconnectURLResolution(constellagent: constellagent)
            guard reconnectResolution.shouldKeepRetrying else {
                constellagent.shouldAutoReconnectOnForeground = false
                constellagent.connectionRecoveryState = .idle
                return
            }

            if constellagent.isConnected {
                constellagent.shouldAutoReconnectOnForeground = false
                constellagent.connectionRecoveryState = .idle
                constellagent.lastErrorMessage = nil
                return
            }

            if constellagent.isConnecting {
                if !constellagent.shouldAutoReconnectOnForeground {
                    constellagent.connectionRecoveryState = .idle
                    return
                }
                await sleepForReconnectBackoff(
                    300_000_000,
                    continueWhile: { constellagent.shouldAutoReconnectOnForeground }
                )
                continue
            }

            guard let fullURL = reconnectResolution.url else {
                constellagent.lastErrorMessage = nil
                constellagent.connectionRecoveryState = .retrying(
                    attempt: max(1, attempt + 1),
                    message: "Reconnecting..."
                )
                let backoffIndex = min(attempt, autoReconnectBackoffNanoseconds.count - 1)
                let backoff = autoReconnectBackoffNanoseconds[backoffIndex]
                attempt += 1
                await sleepForReconnectBackoff(
                    backoff,
                    continueWhile: { constellagent.shouldAutoReconnectOnForeground }
                )
                continue
            }
            do {
                constellagent.connectionRecoveryState = .retrying(
                    attempt: max(1, attempt + 1),
                    message: "Reconnecting..."
                )
                try await connect(constellagent: constellagent, serverURL: fullURL)
                constellagent.connectionRecoveryState = .idle
                constellagent.lastErrorMessage = nil
                constellagent.shouldAutoReconnectOnForeground = false
                return
            } catch {
                if constellagent.secureConnectionState == .rePairRequired {
                    constellagent.connectionRecoveryState = .idle
                    constellagent.shouldAutoReconnectOnForeground = false
                    if constellagent.lastErrorMessage?.isEmpty ?? true {
                        constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(error)
                    }
                    return
                }

                if isCancellationLikeError(error) {
                    constellagent.connectionRecoveryState = .idle
                    return
                }

                if !constellagent.shouldAutoReconnectOnForeground {
                    constellagent.connectionRecoveryState = .idle
                    return
                }

                let isRetryable = constellagent.isRecoverableTransientConnectionError(error)
                    || constellagent.isBenignBackgroundDisconnect(error)
                    || constellagent.isRetryableSavedSessionConnectError(error)

                guard isRetryable else {
                    constellagent.connectionRecoveryState = .idle
                    constellagent.shouldAutoReconnectOnForeground = false
                    constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(error)
                    return
                }

                constellagent.lastErrorMessage = nil
                constellagent.connectionRecoveryState = .retrying(
                    attempt: attempt + 1,
                    message: constellagent.recoveryStatusMessage(for: error)
                )

                let backoffIndex = min(attempt, autoReconnectBackoffNanoseconds.count - 1)
                let backoff = autoReconnectBackoffNanoseconds[backoffIndex]
                attempt += 1
                await sleepForReconnectBackoff(
                    backoff,
                    continueWhile: { constellagent.shouldAutoReconnectOnForeground }
                )
            }
        }

        // Exhausted all attempts — stop retrying but keep the saved pairing for next foreground cycle.
        if attempt >= maxAttempts {
            constellagent.shouldAutoReconnectOnForeground = false
            constellagent.connectionRecoveryState = .idle
            constellagent.lastErrorMessage = "Could not reconnect. Tap Reconnect to try again."
        }
    }
}

private struct MacSwitchInterruptTimeout: Error {}

extension ContentViewModel {
    private enum ReconnectURLResolution {
        case use(String)
        case fallbackToSaved
        case retryLater
        case stop
    }

    private struct AutoRecoveryReconnectURLResolution {
        let url: String?
        let shouldKeepRetrying: Bool
    }

    func connect(constellagent: ConstellagentService, serverURL: String) async throws {
        if let connectOverride {
            try await connectOverride(constellagent, serverURL)
            return
        }

        try await constellagent.connect(
            serverURL: serverURL,
            token: "",
            role: "iphone"
        )
    }

    // Re-resolves the reconnect target on every retry so bridge restarts cannot pin
    // launch/manual recovery loops to one stale saved session id.
    func connectWithAutoRecovery(
        constellagent: ConstellagentService,
        performAutoRetry: Bool,
        continueWhile shouldContinue: (() -> Bool)? = nil,
        serverURLProvider: () async -> String?
    ) async throws {
        guard !isRunningAutoReconnect else {
            return
        }

        isRunningAutoReconnect = true
        defer { isRunningAutoReconnect = false }

        let maxAttemptIndex = performAutoRetry ? autoReconnectBackoffNanoseconds.count : 0
        var lastError: Error?

        for attemptIndex in 0...maxAttemptIndex {
            if Task.isCancelled {
                constellagent.connectionRecoveryState = .idle
                throw CancellationError()
            }

            guard shouldContinue?() ?? true else {
                constellagent.connectionRecoveryState = .idle
                throw CancellationError()
            }

            guard let serverURL = await serverURLProvider() else {
                constellagent.connectionRecoveryState = .idle
                return
            }

            guard shouldContinue?() ?? true else {
                constellagent.connectionRecoveryState = .idle
                throw CancellationError()
            }

            if attemptIndex > 0 {
                constellagent.connectionRecoveryState = .retrying(
                    attempt: attemptIndex,
                    message: "Connection timed out. Retrying..."
                )
            }

            do {
                try await connect(constellagent: constellagent, serverURL: serverURL)
                constellagent.connectionRecoveryState = .idle
                constellagent.lastErrorMessage = nil
                constellagent.shouldAutoReconnectOnForeground = false
                constellagent.clearPreviousTrustedMacDeviceId()
                macSwitchNotice = nil
                return
            } catch {
                if isCancellationLikeError(error) {
                    constellagent.connectionRecoveryState = .idle
                    throw error
                }

                lastError = error
                if constellagent.secureConnectionState == .rePairRequired {
                    constellagent.connectionRecoveryState = .idle
                    constellagent.shouldAutoReconnectOnForeground = false
                    if constellagent.lastErrorMessage?.isEmpty ?? true {
                        constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(error)
                    }
                    throw error
                }

                let isRetryable = constellagent.isRecoverableTransientConnectionError(error)
                    || constellagent.isBenignBackgroundDisconnect(error)
                    || constellagent.isRetryableSavedSessionConnectError(error)

                guard performAutoRetry,
                      isRetryable,
                      attemptIndex < autoReconnectBackoffNanoseconds.count else {
                    constellagent.connectionRecoveryState = .idle
                    constellagent.shouldAutoReconnectOnForeground = false
                    constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(error)
                    throw error
                }

                constellagent.lastErrorMessage = nil
                constellagent.connectionRecoveryState = .retrying(
                    attempt: attemptIndex + 1,
                    message: constellagent.recoveryStatusMessage(for: error)
                )
                await sleepForReconnectBackoff(
                    autoReconnectBackoffNanoseconds[attemptIndex],
                    continueWhile: shouldContinue
                )
                if Task.isCancelled {
                    constellagent.connectionRecoveryState = .idle
                    throw CancellationError()
                }
            }
        }

        if let lastError {
            constellagent.connectionRecoveryState = .idle
            constellagent.shouldAutoReconnectOnForeground = false
            constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(lastError)
            throw lastError
        }
    }

    // Chooses the best reconnect path: resolve the live trusted-Mac session first, then fall back to the saved QR session.
    func preferredReconnectURL(constellagent: ConstellagentService) async -> String? {
        await preferredReconnectURL(
            constellagent: constellagent,
            targetMacDeviceId: constellagent.normalizedCurrentTrustedMacDeviceId
        )
    }

    // Resolves a reconnect URL for an explicit Mac target, instead of implicitly following the current one.
    func preferredReconnectURL(
        constellagent: ConstellagentService,
        targetMacDeviceId: String?
    ) async -> String? {
        switch await trustedReconnectResolution(
            constellagent: constellagent,
            targetMacDeviceId: targetMacDeviceId
        ) {
        case .use(let resolvedURL):
            return resolvedURL
        case .fallbackToSaved:
            return savedReconnectURL(constellagent: constellagent, targetMacDeviceId: targetMacDeviceId)
        case .retryLater:
            return nil
        case .stop:
            return nil
        }
    }

    // Keeps launch/foreground recovery alive while the bridge is still re-registering after sleep.
    private func autoRecoveryReconnectURLResolution(constellagent: ConstellagentService) async -> AutoRecoveryReconnectURLResolution {
        let targetMacDeviceId = constellagent.normalizedCurrentTrustedMacDeviceId
        switch await trustedReconnectResolution(
            constellagent: constellagent,
            targetMacDeviceId: targetMacDeviceId
        ) {
        case .use(let resolvedURL):
            return AutoRecoveryReconnectURLResolution(url: resolvedURL, shouldKeepRetrying: true)
        case .fallbackToSaved:
            if let savedURL = savedReconnectURL(constellagent: constellagent, targetMacDeviceId: targetMacDeviceId) {
                return AutoRecoveryReconnectURLResolution(url: savedURL, shouldKeepRetrying: true)
            }
            return AutoRecoveryReconnectURLResolution(
                url: nil,
                shouldKeepRetrying: constellagent.hasTrustedMacReconnectCandidate
            )
        case .retryLater:
            return AutoRecoveryReconnectURLResolution(url: nil, shouldKeepRetrying: true)
        case .stop:
            return AutoRecoveryReconnectURLResolution(url: nil, shouldKeepRetrying: false)
        }
    }

    // Resolves a trusted-Mac session when possible and tells the caller whether to use, fall back, or stop.
    private func trustedReconnectResolution(constellagent: ConstellagentService) async -> ReconnectURLResolution {
        await trustedReconnectResolution(
            constellagent: constellagent,
            targetMacDeviceId: constellagent.normalizedCurrentTrustedMacDeviceId
        )
    }

    private func trustedReconnectResolution(
        constellagent: ConstellagentService,
        targetMacDeviceId: String?
    ) async -> ReconnectURLResolution {
        let normalizedTargetMacDeviceId = normalizedMacDeviceId(targetMacDeviceId)
        guard let targetMacDeviceId = normalizedTargetMacDeviceId,
              let trustedMac = constellagent.trustedMacRecord(for: targetMacDeviceId),
              trustedMac.relayURL?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            logMacSwitchState("resolve-skip-no-trusted-target", targetMacDeviceId: normalizedTargetMacDeviceId, constellagent: constellagent)
            return .fallbackToSaved
        }

        do {
            logMacSwitchState("resolve-start", targetMacDeviceId: targetMacDeviceId, constellagent: constellagent)
            guard let trustedReconnectURL = try await resolvedTrustedReconnectURL(
                constellagent: constellagent,
                targetMacDeviceId: targetMacDeviceId
            ) else {
                logMacSwitchState("resolve-empty", targetMacDeviceId: targetMacDeviceId, constellagent: constellagent)
                return .fallbackToSaved
            }
            logMacSwitchState("resolve-use-live-session", targetMacDeviceId: targetMacDeviceId, constellagent: constellagent)
            return .use(trustedReconnectURL)
        } catch let error as ConstellagentTrustedSessionResolveError {
            logMacSwitchState(
                "resolve-error \(String(describing: error))",
                targetMacDeviceId: targetMacDeviceId,
                constellagent: constellagent
            )
            if case .macOffline = error,
               let alternate = await resolvedAlternateTrustedReconnectURL(
                    constellagent: constellagent,
                    offlineTrustedMac: trustedMac
               ) {
                logMacSwitchState(
                    "resolve-use-alternate-live-record from=\(redactedMacSwitchIdentifier(targetMacDeviceId))",
                    targetMacDeviceId: alternate.macDeviceId,
                    constellagent: constellagent
                )
                return .use(alternate.url)
            }
            if case .macOffline = error {
                let prunedCount = constellagent.pruneOfflineTrustedMacRecords(matching: trustedMac)
                logMacSwitchState(
                    "pruned-offline-selection count=\(prunedCount)",
                    targetMacDeviceId: targetMacDeviceId,
                    constellagent: constellagent
                )
                if prunedCount > 0 {
                    macSwitchNotice = "Removed old saved entries for that device. Scan its QR code once if it is still missing."
                }
            }
            return trustedReconnectResolution(
                for: error,
                constellagent: constellagent,
                targetMacDeviceId: targetMacDeviceId
            )
        } catch is CancellationError {
            logMacSwitchState("resolve-cancelled", targetMacDeviceId: targetMacDeviceId, constellagent: constellagent)
            return .stop
        } catch {
            if savedReconnectURL(constellagent: constellagent, targetMacDeviceId: targetMacDeviceId) == nil {
                constellagent.lastErrorMessage = constellagent.userFacingTurnErrorMessageForFooter(from: error)
            }
            let message = constellagent.userFacingTurnErrorMessageForFooter(from: error) ?? String(describing: error)
            logMacSwitchState(
                "resolve-unexpected-error \(message)",
                targetMacDeviceId: targetMacDeviceId,
                constellagent: constellagent
            )
            return .fallbackToSaved
        }
    }

    // Builds the live reconnect URL after the trusted-session lookup succeeds.
    private func resolvedTrustedReconnectURL(
        constellagent: ConstellagentService,
        targetMacDeviceId: String
    ) async throws -> String? {
        let resolved = try await constellagent.resolveTrustedMacSession(deviceId: targetMacDeviceId)
        guard let trustedMac = constellagent.trustedMacRecord(for: targetMacDeviceId),
              let relayURL = trustedMac.relayURL?.trimmingCharacters(in: .whitespacesAndNewlines),
              !relayURL.isEmpty else {
            return nil
        }
        try validateResolvedTrustedReconnectTarget(resolved, trustedMac: trustedMac)
        return "\(relayURL)/\(resolved.sessionId)"
    }

    // Recovers from stale duplicate records by trying only records with the same stable Mac key.
    private func resolvedAlternateTrustedReconnectURL(
        constellagent: ConstellagentService,
        offlineTrustedMac: ConstellagentTrustedMacRecord
    ) async -> (url: String, macDeviceId: String)? {
        let candidates = alternateTrustedMacCandidates(
            for: offlineTrustedMac,
            constellagent: constellagent
        )
        for candidate in candidates {
            do {
                guard let url = try await resolvedTrustedReconnectURL(
                    constellagent: constellagent,
                    targetMacDeviceId: candidate.macDeviceId
                ) else {
                    continue
                }
                constellagent.setCurrentTrustedMacDeviceId(candidate.macDeviceId)
                return (url, candidate.macDeviceId)
            } catch {
                logMacSwitchState(
                    "resolve-alternate-failed \(String(describing: error))",
                    targetMacDeviceId: candidate.macDeviceId,
                    constellagent: constellagent
                )
                continue
            }
        }
        return nil
    }

    private func alternateTrustedMacCandidates(
        for trustedMac: ConstellagentTrustedMacRecord,
        constellagent: ConstellagentService
    ) -> [ConstellagentTrustedMacRecord] {
        let trustedPublicKey = trustedMac.macIdentityPublicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trustedPublicKey.isEmpty else {
            return []
        }

        return constellagent.trustedMacRegistry.records.values
            .filter { candidate in
                let candidatePublicKey = candidate.macIdentityPublicKey.trimmingCharacters(in: .whitespacesAndNewlines)
                return candidate.macDeviceId != trustedMac.macDeviceId
                    && candidatePublicKey == trustedPublicKey
                    && candidate.relayURL?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            }
            .sorted { lhs, rhs in
                trustedMacActivityDate(lhs) > trustedMacActivityDate(rhs)
            }
    }

    private func trustedMacActivityDate(_ trustedMac: ConstellagentTrustedMacRecord) -> Date {
        trustedMac.lastResolvedAt ?? trustedMac.lastUsedAt ?? trustedMac.lastPairedAt
    }

    // Test overrides and relay responses must not silently retarget a manual Mac switch.
    private func validateResolvedTrustedReconnectTarget(
        _ resolved: ConstellagentTrustedSessionResolveResponse,
        trustedMac: ConstellagentTrustedMacRecord
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

    // Applies trusted-resolve error policy without mixing it into the happy path URL assembly.
    private func trustedReconnectResolution(
        for error: ConstellagentTrustedSessionResolveError,
        constellagent: ConstellagentService,
        targetMacDeviceId: String?
    ) -> ReconnectURLResolution {
        let hasSavedReconnectURL = savedReconnectURL(constellagent: constellagent, targetMacDeviceId: targetMacDeviceId) != nil
        switch error {
        case .unsupportedRelay:
            if !hasSavedReconnectURL {
                constellagent.secureConnectionState = .liveSessionUnresolved
                constellagent.connectionRecoveryState = .idle
                constellagent.shouldAutoReconnectOnForeground = false
                constellagent.lastErrorMessage = "Trusted reconnect is unavailable from this relay endpoint. Update or check the relay/proxy, then reconnect. Scan a new QR code only if this device was reset."
                return .stop
            }
            return .fallbackToSaved
        case .macOffline(let message):
            if hasSavedReconnectURL {
                constellagent.lastErrorMessage = nil
                return .fallbackToSaved
            }
            if isConnectedToDifferentCurrentDevice(constellagent: constellagent, targetMacDeviceId: targetMacDeviceId) {
                macSwitchNotice = "That device is not reachable yet. Make sure its bridge is connected, or rescan its QR code."
                return .retryLater
            }
            constellagent.lastErrorMessage = message
            return .retryLater
        case .rePairRequired(let message):
            if hasSavedReconnectURL {
                // Trusted-session lookup is only a shortcut; the target-matched saved socket handshake is the authority.
                constellagent.restoreTrustedPairPresentationState()
                constellagent.lastErrorMessage = nil
                return .fallbackToSaved
            }
            constellagent.connectionRecoveryState = .idle
            constellagent.shouldAutoReconnectOnForeground = false
            constellagent.lastErrorMessage = message
            return .stop
        case .noTrustedMac:
            return .fallbackToSaved
        case .invalidResponse(let message), .network(let message):
            if !hasSavedReconnectURL {
                constellagent.secureConnectionState = .liveSessionUnresolved
                constellagent.lastErrorMessage = message
            }
            return .fallbackToSaved
        }
    }

    // Reuses the last QR-resolved session when trusted lookup is unavailable or not yet supported end-to-end.
    private func savedReconnectURL(constellagent: ConstellagentService, targetMacDeviceId: String?) -> String? {
        guard let sessionId = constellagent.normalizedRelaySessionId,
              let relayURL = constellagent.normalizedRelayURL else {
            return nil
        }

        if let normalizedTargetMacDeviceId = normalizedMacDeviceId(targetMacDeviceId),
           constellagent.normalizedRelayMacDeviceId != normalizedTargetMacDeviceId {
            return nil
        }
        return "\(relayURL)/\(sessionId)"
    }

    private func isConnectedToDifferentCurrentDevice(constellagent: ConstellagentService, targetMacDeviceId: String?) -> Bool {
        guard constellagent.isConnected,
              let currentDeviceId = constellagent.normalizedCurrentTrustedMacDeviceId,
              let targetDeviceId = normalizedMacDeviceId(targetMacDeviceId) else {
            return false
        }
        return currentDeviceId != targetDeviceId
    }

    func switchToTrustedMac(deviceId: String, constellagent: ConstellagentService) async throws {
        let normalizedTargetMacDeviceId = try normalizedRequiredMacDeviceId(deviceId)
        logMacSwitchState("start", targetMacDeviceId: normalizedTargetMacDeviceId, constellagent: constellagent)
        guard normalizedTargetMacDeviceId != constellagent.normalizedCurrentTrustedMacDeviceId else {
            logMacSwitchState("ignored-already-current", targetMacDeviceId: normalizedTargetMacDeviceId, constellagent: constellagent)
            return
        }
        guard !isSwitchingMac else {
            logMacSwitchState("ignored-switch-in-flight", targetMacDeviceId: normalizedTargetMacDeviceId, constellagent: constellagent)
            return
        }

        isSwitchingMac = true
        isCancellingMacSwitch = false
        switchingMacDeviceId = normalizedTargetMacDeviceId
        macSwitchNotice = nil
        defer {
            isCancellingMacSwitch = false
            switchingMacDeviceId = nil
            isSwitchingMac = false
        }

        var effectiveTargetMacDeviceId = normalizedTargetMacDeviceId
        let previousCurrentTrustedMacDeviceId = constellagent.normalizedCurrentTrustedMacDeviceId
        let previousErrorMessage = constellagent.lastErrorMessage
        constellagent.lastErrorMessage = nil

        do {
            // Resolve the selected Mac before touching the live socket so an offline/stale record cannot drop the current connection.
            guard let fullURL = await preferredReconnectURL(
                constellagent: constellagent,
                targetMacDeviceId: normalizedTargetMacDeviceId
            ) else {
                let switchFailureMessage = macSwitchNotice
                    ?? constellagent.lastErrorMessage
                    ?? "Could not reconnect to the selected device."
                macSwitchNotice = switchFailureMessage
                constellagent.lastErrorMessage = isConnectedToDifferentCurrentDevice(
                    constellagent: constellagent,
                    targetMacDeviceId: normalizedTargetMacDeviceId
                ) ? previousErrorMessage : switchFailureMessage
                logMacSwitchState("missing-reconnect-url-keeping-current", targetMacDeviceId: normalizedTargetMacDeviceId, constellagent: constellagent)
                throw ConstellagentServiceError.invalidInput("Could not reconnect to the selected device.")
            }
            if let resolvedMacDeviceId = constellagent.normalizedRelayMacDeviceId,
               resolvedMacDeviceId != effectiveTargetMacDeviceId {
                effectiveTargetMacDeviceId = resolvedMacDeviceId
                switchingMacDeviceId = resolvedMacDeviceId
                logMacSwitchState("retargeted-live-record", targetMacDeviceId: resolvedMacDeviceId, constellagent: constellagent)
            }

            try await interruptRunningTurnsBeforeMacSwitchIfNeeded(constellagent: constellagent)
            await stopAutoReconnectForManualRetry(constellagent: constellagent)

            constellagent.saveLocalState(for: previousCurrentTrustedMacDeviceId)
            beginMacSwitchContext(effectiveTargetMacDeviceId, constellagent: constellagent)
            if let previousCurrentTrustedMacDeviceId {
                constellagent.setPreviousTrustedMacDeviceId(previousCurrentTrustedMacDeviceId)
            } else {
                constellagent.clearPreviousTrustedMacDeviceId()
            }
            constellagent.setCurrentTrustedMacDeviceId(effectiveTargetMacDeviceId)
            await constellagent.disconnect(preserveReconnectIntent: false)
            prepareMacSwitchState(for: effectiveTargetMacDeviceId, constellagent: constellagent, loadCachedMessages: false)
            logMacSwitchState("prepared-target-state", targetMacDeviceId: effectiveTargetMacDeviceId, constellagent: constellagent)

            if let resolvedMacDeviceId = constellagent.normalizedRelayMacDeviceId,
               resolvedMacDeviceId != effectiveTargetMacDeviceId {
                effectiveTargetMacDeviceId = resolvedMacDeviceId
                switchingMacDeviceId = resolvedMacDeviceId
                constellagent.setCurrentTrustedMacDeviceId(resolvedMacDeviceId)
                constellagent.macScopedContextOverrideDeviceId = resolvedMacDeviceId
                prepareMacSwitchState(for: resolvedMacDeviceId, constellagent: constellagent, loadCachedMessages: false)
                logMacSwitchState("retargeted-live-record", targetMacDeviceId: resolvedMacDeviceId, constellagent: constellagent)
            }

            logMacSwitchState("connect-start", targetMacDeviceId: effectiveTargetMacDeviceId, constellagent: constellagent)
            try await connectWithAutoRecovery(
                constellagent: constellagent,
                performAutoRetry: true,
                continueWhile: { !self.isCancellingMacSwitch },
                serverURLProvider: { fullURL }
            )
            constellagent.setCurrentTrustedMacDeviceId(effectiveTargetMacDeviceId)
            macSwitchNotice = nil
            endMacSwitchContext(constellagent: constellagent)
            logMacSwitchState("success", targetMacDeviceId: effectiveTargetMacDeviceId, constellagent: constellagent)
        } catch is CancellationError {
            logMacSwitchState("cancelled", targetMacDeviceId: effectiveTargetMacDeviceId, constellagent: constellagent)
            await finalizeCancelledMacSwitch(
                previousCurrentTrustedMacDeviceId: previousCurrentTrustedMacDeviceId,
                constellagent: constellagent
            )
            throw CancellationError()
        } catch {
            if isCancellingMacSwitch {
                logMacSwitchState("cancel-requested", targetMacDeviceId: effectiveTargetMacDeviceId, constellagent: constellagent)
                await finalizeCancelledMacSwitch(
                    previousCurrentTrustedMacDeviceId: previousCurrentTrustedMacDeviceId,
                    constellagent: constellagent
                )
                throw CancellationError()
            }
            if constellagent.isConnected || constellagent.isInitialized {
                constellagent.setCurrentTrustedMacDeviceId(previousCurrentTrustedMacDeviceId)
                constellagent.clearPreviousTrustedMacDeviceId()
                macSwitchNotice = macSwitchNotice
                    ?? constellagent.lastErrorMessage
                    ?? previousErrorMessage
                    ?? constellagent.userFacingConnectFailureMessage(error)
                constellagent.lastErrorMessage = previousErrorMessage
                logMacSwitchState("failed-before-disconnect-kept-current \(macSwitchNotice ?? "")", targetMacDeviceId: normalizedTargetMacDeviceId, constellagent: constellagent)
                throw error
            }
            constellagent.setCurrentTrustedMacDeviceId(effectiveTargetMacDeviceId)
            constellagent.macScopedContextOverrideDeviceId = effectiveTargetMacDeviceId
            prepareMacSwitchState(for: effectiveTargetMacDeviceId, constellagent: constellagent, loadCachedMessages: true)
            restoreSelectedMacPresentationAfterFailedSwitch(constellagent: constellagent)
            if constellagent.lastErrorMessage?.isEmpty ?? true {
                constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(error)
            } else if constellagent.lastErrorMessage == nil {
                constellagent.lastErrorMessage = previousErrorMessage
            }
            macSwitchNotice = constellagent.lastErrorMessage
            endMacSwitchContext(constellagent: constellagent)
            logMacSwitchState("failed \(constellagent.lastErrorMessage ?? constellagent.userFacingConnectFailureMessage(error))", targetMacDeviceId: effectiveTargetMacDeviceId, constellagent: constellagent)
            throw error
        }
    }

    func switchToScannedMac(pairingPayload: ConstellagentPairingQRPayload, constellagent: ConstellagentService) async throws {
        guard !isSwitchingMac else {
            return
        }

        isSwitchingMac = true
        isCancellingMacSwitch = false
        switchingMacDeviceId = pairingPayload.macDeviceId
        macSwitchNotice = nil
        defer {
            isCancellingMacSwitch = false
            switchingMacDeviceId = nil
            isSwitchingMac = false
        }

        let previousCurrentTrustedMacDeviceId = constellagent.normalizedCurrentTrustedMacDeviceId
        let previousErrorMessage = constellagent.lastErrorMessage
        let previousRelaySessionSnapshot = captureRelaySessionSnapshot(from: constellagent)
        constellagent.lastErrorMessage = nil

        try await interruptRunningTurnsBeforeMacSwitchIfNeeded(constellagent: constellagent)
        await stopAutoReconnectForManualScan(constellagent: constellagent)
        constellagent.saveLocalState(for: previousCurrentTrustedMacDeviceId)
        beginMacSwitchContext(pairingPayload.macDeviceId, constellagent: constellagent)
        constellagent.rememberRelayPairing(pairingPayload)
        prepareMacSwitchState(for: pairingPayload.macDeviceId, constellagent: constellagent, loadCachedMessages: false)

        do {
            try await connectWithAutoRecovery(
                constellagent: constellagent,
                performAutoRetry: true,
                continueWhile: { !self.isCancellingMacSwitch },
                serverURLProvider: { "\(pairingPayload.relay)/\(pairingPayload.sessionId)" }
            )
            endMacSwitchContext(constellagent: constellagent)
        } catch is CancellationError {
            await finalizeCancelledMacSwitch(
                previousCurrentTrustedMacDeviceId: previousCurrentTrustedMacDeviceId,
                constellagent: constellagent
            )
            throw CancellationError()
        } catch {
            if isCancellingMacSwitch {
                await finalizeCancelledMacSwitch(
                    previousCurrentTrustedMacDeviceId: previousCurrentTrustedMacDeviceId,
                    constellagent: constellagent
                )
                throw CancellationError()
            }
            constellagent.setCurrentTrustedMacDeviceId(previousCurrentTrustedMacDeviceId)
            restoreRelaySessionSnapshot(previousRelaySessionSnapshot, to: constellagent)
            constellagent.macScopedContextOverrideDeviceId = previousCurrentTrustedMacDeviceId
            prepareMacSwitchState(for: previousCurrentTrustedMacDeviceId, constellagent: constellagent, loadCachedMessages: true)
            endMacSwitchContext(constellagent: constellagent)
            if constellagent.lastErrorMessage?.isEmpty ?? true {
                constellagent.lastErrorMessage = constellagent.userFacingConnectFailureMessage(error)
            } else if constellagent.lastErrorMessage == nil {
                constellagent.lastErrorMessage = previousErrorMessage
            }
            throw error
        }
    }

    func requestMacSwitchCancellation(constellagent: ConstellagentService) async {
        guard isSwitchingMac else {
            return
        }

        isCancellingMacSwitch = true
        constellagent.shouldAutoReconnectOnForeground = false
        constellagent.connectionRecoveryState = .idle
        constellagent.cancelTrustedSessionResolve()
        if constellagent.isConnecting || constellagent.isConnected || constellagent.isInitialized {
            await constellagent.disconnect(preserveReconnectIntent: false)
        }
    }

    // Centralizes reconnect sleeps so manual retry can interrupt stale foreground backoff quickly.
    private func sleepForReconnectBackoff(
        _ nanoseconds: UInt64,
        continueWhile shouldContinue: (() -> Bool)? = nil
    ) async {
        if let reconnectSleepOverride {
            await reconnectSleepOverride(nanoseconds)
            return
        }

        guard let shouldContinue else {
            try? await Task.sleep(nanoseconds: nanoseconds)
            return
        }

        var remaining = nanoseconds
        let chunkSize = max(1 as UInt64, reconnectSleepChunkNanosecondsOverride ?? reconnectSleepChunkNanoseconds)
        while remaining > 0 {
            guard shouldContinue() else {
                return
            }

            let nextChunk = min(remaining, chunkSize)
            try? await Task.sleep(nanoseconds: nextChunk)
            remaining -= nextChunk
        }
    }

    // Treats cancelled resolve/connect work as intentional handoff, not as a user-visible failure.
    private func isCancellationLikeError(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }

        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    private var shouldContinueManualReconnect: Bool {
        !shouldCancelManualReconnect
    }

    private func normalizedMacDeviceId(_ deviceId: String?) -> String? {
        guard let trimmed = deviceId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func normalizedRequiredMacDeviceId(_ deviceId: String?) throws -> String {
        guard let normalizedMacDeviceId = normalizedMacDeviceId(deviceId) else {
            throw ConstellagentServiceError.invalidInput("A valid device id is required.")
        }
        return normalizedMacDeviceId
    }

    private func beginMacSwitchContext(_ macDeviceId: String?, constellagent: ConstellagentService) {
        constellagent.suspendAutomaticMacScopedPersistence = true
        constellagent.macScopedContextOverrideDeviceId = normalizedMacDeviceId(macDeviceId)
    }

    private func prepareMacSwitchState(
        for macDeviceId: String?,
        constellagent: ConstellagentService,
        loadCachedMessages: Bool
    ) {
        constellagent.clearInMemoryMacScopedState()
        if loadCachedMessages {
            constellagent.loadLocalState(for: macDeviceId)
        }
        // Manual switches wait for live sync before showing messages so stale per-Mac caches do not flash.
        constellagent.loadMacScopedDefaultsState(for: macDeviceId)
    }

    private func endMacSwitchContext(constellagent: ConstellagentService) {
        constellagent.macScopedContextOverrideDeviceId = nil
        constellagent.suspendAutomaticMacScopedPersistence = false
    }

    // Keeps an explicit manual Mac selection durable even when the socket cannot reconnect yet.
    private func restoreSelectedMacPresentationAfterFailedSwitch(constellagent: ConstellagentService) {
        if constellagent.secureConnectionState == .rePairRequired || constellagent.secureConnectionState == .updateRequired {
            return
        }

        constellagent.restoreTrustedPairPresentationState()
    }

    // Emits redacted switch traces so manual Mac switching can be debugged from device logs.
    private func logMacSwitchState(_ event: String, targetMacDeviceId: String?, constellagent: ConstellagentService) {
        let target = redactedMacSwitchIdentifier(targetMacDeviceId)
        let current = redactedMacSwitchIdentifier(constellagent.normalizedCurrentTrustedMacDeviceId)
        let previous = redactedMacSwitchIdentifier(constellagent.normalizedPreviousTrustedMacDeviceId)
        let relayMac = redactedMacSwitchIdentifier(constellagent.normalizedRelayMacDeviceId)
        let relaySession = redactedMacSwitchIdentifier(constellagent.normalizedRelaySessionId)
        print(
            "[ConstellagentSwitch] \(event) target=\(target) current=\(current) previous=\(previous) "
            + "relayMac=\(relayMac) relaySession=\(relaySession) connected=\(constellagent.isConnected) "
            + "state=\(constellagent.secureConnectionState.statusLabel)"
        )
    }

    private func redactedMacSwitchIdentifier(_ value: String?) -> String {
        guard let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !normalized.isEmpty else {
            return "none"
        }
        return SHA256.hash(data: Data(normalized.utf8))
            .compactMap { String(format: "%02x", $0) }
            .joined()
            .prefix(8)
            .description
    }

    private func interruptRunningTurnsBeforeMacSwitchIfNeeded(constellagent: ConstellagentService) async throws {
        guard constellagent.isConnected || constellagent.isInitialized else {
            return
        }

        let runningCount = constellagent.runningThreadIDs.count
        let protectedCount = constellagent.protectedRunningFallbackThreadIDs.count
        let activeCount = constellagent.activeTurnIdByThread.count
        guard runningCount > 0 || protectedCount > 0 || activeCount > 0 else {
            return
        }

        logMacSwitchState(
            "interrupt-running-start running=\(runningCount) protected=\(protectedCount) active=\(activeCount)",
            targetMacDeviceId: switchingMacDeviceId,
            constellagent: constellagent
        )

        do {
            try await runMacSwitchInterruptPreflight(constellagent: constellagent)
            logMacSwitchState("interrupt-running-finished", targetMacDeviceId: switchingMacDeviceId, constellagent: constellagent)
        } catch is MacSwitchInterruptTimeout {
            constellagent.lastErrorMessage = nil
            logMacSwitchState("interrupt-running-timeout-continuing", targetMacDeviceId: switchingMacDeviceId, constellagent: constellagent)
        } catch {
            constellagent.lastErrorMessage = nil
            logMacSwitchState(
                "interrupt-running-failed-continuing \(constellagent.userFacingTurnErrorMessageForFooter(from: error) ?? String(describing: error))",
                targetMacDeviceId: switchingMacDeviceId,
                constellagent: constellagent
            )
        }
    }

    // Interrupting the old Mac is best-effort; stale run state must not block an explicit Mac switch.
    private func runMacSwitchInterruptPreflight(constellagent: ConstellagentService) async throws {
        let timeoutNanoseconds = macSwitchInterruptTimeoutNanoseconds
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                try await constellagent.interruptAllRunningTurnsBeforeMacSwitch()
            }
            group.addTask {
                try await Task.sleep(nanoseconds: timeoutNanoseconds)
                throw MacSwitchInterruptTimeout()
            }

            do {
                _ = try await group.next()
                group.cancelAll()
            } catch {
                group.cancelAll()
                throw error
            }
        }
    }

    private func finalizeCancelledMacSwitch(
        previousCurrentTrustedMacDeviceId: String?,
        constellagent: ConstellagentService
    ) async {
        constellagent.lastErrorMessage = nil
        constellagent.connectionRecoveryState = .idle
        constellagent.shouldAutoReconnectOnForeground = false
        constellagent.cancelTrustedSessionResolve()
        await constellagent.disconnect(preserveReconnectIntent: false)
        constellagent.setCurrentTrustedMacDeviceId(nil)
        if let previousCurrentTrustedMacDeviceId {
            constellagent.setPreviousTrustedMacDeviceId(previousCurrentTrustedMacDeviceId)
        }
        constellagent.clearSavedRelaySession()
        constellagent.clearInMemoryMacScopedState()
        endMacSwitchContext(constellagent: constellagent)
        macSwitchNotice = "Switch cancelled. Choose a device to reconnect."
    }

    private func captureRelaySessionSnapshot(from constellagent: ConstellagentService) -> RelaySessionSnapshot {
        RelaySessionSnapshot(
            relaySessionId: constellagent.relaySessionId,
            relayUrl: constellagent.relayUrl,
            relayMacDeviceId: constellagent.relayMacDeviceId,
            relayMacIdentityPublicKey: constellagent.relayMacIdentityPublicKey,
            relayProtocolVersion: constellagent.relayProtocolVersion,
            lastAppliedBridgeOutboundSeq: constellagent.lastAppliedBridgeOutboundSeq,
            shouldForceQRBootstrapOnNextHandshake: constellagent.shouldForceQRBootstrapOnNextHandshake,
            trustedReconnectFailureCount: constellagent.trustedReconnectFailureCount,
            secureConnectionState: constellagent.secureConnectionState,
            secureMacFingerprint: constellagent.secureMacFingerprint
        )
    }

    private func restoreRelaySessionSnapshot(_ snapshot: RelaySessionSnapshot, to constellagent: ConstellagentService) {
        constellagent.relaySessionId = snapshot.relaySessionId
        constellagent.relayUrl = snapshot.relayUrl
        constellagent.relayMacDeviceId = snapshot.relayMacDeviceId
        constellagent.relayMacIdentityPublicKey = snapshot.relayMacIdentityPublicKey
        constellagent.relayProtocolVersion = snapshot.relayProtocolVersion
        constellagent.lastAppliedBridgeOutboundSeq = snapshot.lastAppliedBridgeOutboundSeq
        constellagent.shouldForceQRBootstrapOnNextHandshake = snapshot.shouldForceQRBootstrapOnNextHandshake
        constellagent.trustedReconnectFailureCount = snapshot.trustedReconnectFailureCount
        constellagent.secureConnectionState = snapshot.secureConnectionState
        constellagent.secureMacFingerprint = snapshot.secureMacFingerprint

        if let relaySessionId = snapshot.relaySessionId {
            SecureStore.writeString(relaySessionId, for: ConstellagentSecureKeys.relaySessionId)
        } else {
            SecureStore.deleteValue(for: ConstellagentSecureKeys.relaySessionId)
        }
        if let relayUrl = snapshot.relayUrl {
            SecureStore.writeString(relayUrl, for: ConstellagentSecureKeys.relayUrl)
        } else {
            SecureStore.deleteValue(for: ConstellagentSecureKeys.relayUrl)
        }
        if let relayMacDeviceId = snapshot.relayMacDeviceId {
            SecureStore.writeString(relayMacDeviceId, for: ConstellagentSecureKeys.relayMacDeviceId)
        } else {
            SecureStore.deleteValue(for: ConstellagentSecureKeys.relayMacDeviceId)
        }
        if let relayMacIdentityPublicKey = snapshot.relayMacIdentityPublicKey {
            SecureStore.writeString(relayMacIdentityPublicKey, for: ConstellagentSecureKeys.relayMacIdentityPublicKey)
        } else {
            SecureStore.deleteValue(for: ConstellagentSecureKeys.relayMacIdentityPublicKey)
        }
        SecureStore.writeString(String(snapshot.relayProtocolVersion), for: ConstellagentSecureKeys.relayProtocolVersion)
        SecureStore.writeString(
            String(snapshot.lastAppliedBridgeOutboundSeq),
            for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq
        )
    }
}
