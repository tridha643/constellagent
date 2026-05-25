// FILE: ConstellagentServiceConnectionErrorTests.swift
// Purpose: Verifies background disconnects stay silent while real connection failures still surface.
// Layer: Unit Test
// Exports: ConstellagentServiceConnectionErrorTests
// Depends on: XCTest, Network, UIKit, Constellagent

import XCTest
import Network
import UIKit
@testable import Constellagent

@MainActor
final class ConstellagentServiceConnectionErrorTests: XCTestCase {
    func testKeepMacAwakePreferenceDefaultsToDisabled() {
        let suiteName = "ConstellagentServiceConnectionErrorTests.keepMacAwake.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)

        let service = ConstellagentService(defaults: defaults)

        XCTAssertFalse(service.keepMacAwakeWhileBridgeRuns)
    }

    func testBenignBackgroundAbortIsSuppressedFromUserFacingErrors() {
        let service = ConstellagentService()
        let error = NWError.posix(.ECONNABORTED)
        service.isAppInForeground = false

        XCTAssertTrue(service.isBenignBackgroundDisconnect(error))
        XCTAssertTrue(service.shouldSuppressUserFacingConnectionError(error))
    }

    func testSendSideNoDataDisconnectIsTreatedAsBenign() {
        let service = ConstellagentService()
        let error = NWError.posix(.ENODATA)
        service.isAppInForeground = false

        XCTAssertTrue(service.isBenignBackgroundDisconnect(error))
        XCTAssertTrue(service.shouldTreatSendFailureAsDisconnect(error))
        XCTAssertTrue(service.shouldSuppressUserFacingConnectionError(error))
    }

    func testConnectionResetIsTreatedAsBenignRelayDisconnect() {
        let service = ConstellagentService()
        let error = NWError.posix(.ECONNRESET)
        service.isAppInForeground = false

        XCTAssertTrue(service.isBenignBackgroundDisconnect(error))
        XCTAssertTrue(service.shouldSuppressUserFacingConnectionError(error))
    }

    func testInactiveAppStateStillSuppressesBenignDisconnectNoise() {
        let service = ConstellagentService()
        let error = NWError.posix(.ECONNRESET)
        service.isAppInForeground = true
        service.applicationStateProvider = { .inactive }

        XCTAssertTrue(service.shouldSuppressUserFacingConnectionError(error))
    }

    func testTransientTimeoutStillSurfacesToUser() {
        let service = ConstellagentService()
        let error = NWError.posix(.ETIMEDOUT)

        XCTAssertTrue(service.isRecoverableTransientConnectionError(error))
        XCTAssertFalse(service.shouldSuppressUserFacingConnectionError(error))
    }

    func testOversizedRelayPayloadGetsFriendlyFailureCopy() {
        let service = ConstellagentService()
        let error = NWError.posix(.EMSGSIZE)

        XCTAssertTrue(service.isOversizedRelayPayloadError(error))
        XCTAssertEqual(
            service.userFacingConnectFailureMessage(error),
            "A thread payload was too large for the relay connection. This can happen while reopening image-heavy chats even if you didn't press Send."
        )
    }

    func testReceiveDispositionUsesFriendlyOversizedPayloadMessage() {
        let service = ConstellagentService()
        let error = NWError.posix(.EMSGSIZE)

        service.handleReceiveError(error)

        XCTAssertEqual(
            service.lastErrorMessage,
            "A thread payload was too large for the relay connection. This can happen while reopening image-heavy chats even if you didn't press Send."
        )
    }

    func testValidateOutgoingWebSocketMessageSizeRejectsOversizedPayload() {
        let service = ConstellagentService()
        let oversizedText = String(repeating: "a", count: constellagentWebSocketMaximumMessageSizeBytes + 1)

        XCTAssertThrowsError(try service.validateOutgoingWebSocketMessageSize(oversizedText)) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "This payload is too large for the relay connection. Try fewer or smaller images and retry."
            )
        }
    }

    func testWebSocketKeepAlivePingsWhileForegrounded() async {
        let service = ConstellagentService()
        var pingCount = 0
        service.isConnected = true
        service.isInitialized = true
        service.isAppInForeground = true
        service.webSocketKeepAliveIntervalOverrideNanoseconds = 1
        service.webSocketKeepAlivePingOverride = {
            pingCount += 1
            service.stopWebSocketKeepAliveLoop()
        }

        service.startWebSocketKeepAliveLoop()

        for _ in 0..<1_000 {
            if pingCount > 0 { break }
            await Task.yield()
        }

        XCTAssertEqual(pingCount, 1)
        XCTAssertNil(service.webSocketKeepAliveTask)
    }

    func testWebSocketKeepAliveDoesNotStartWhileBackgrounded() async {
        let service = ConstellagentService()
        var pingCount = 0
        service.isConnected = true
        service.isInitialized = true
        service.isAppInForeground = false
        service.webSocketKeepAliveIntervalOverrideNanoseconds = 1
        service.webSocketKeepAlivePingOverride = {
            pingCount += 1
        }

        service.startWebSocketKeepAliveLoop()
        await Task.yield()

        XCTAssertEqual(pingCount, 0)
        XCTAssertNil(service.webSocketKeepAliveTask)
    }

    func testForegroundStateStopsAndRestartsWebSocketKeepAlive() {
        let service = ConstellagentService()
        service.syncRealtimeEnabled = false
        service.isConnected = true
        service.isInitialized = true
        service.isAppInForeground = true
        service.webSocketKeepAlivePingOverride = {}

        service.startWebSocketKeepAliveLoop()
        XCTAssertNotNil(service.webSocketKeepAliveTask)

        service.setForegroundState(false)
        XCTAssertNil(service.webSocketKeepAliveTask)

        service.setForegroundState(true)
        XCTAssertNotNil(service.webSocketKeepAliveTask)
        service.stopWebSocketKeepAliveLoop()
    }

    func testDisconnectStopsWebSocketKeepAlive() async {
        let service = ConstellagentService()
        service.isConnected = true
        service.isInitialized = true
        service.isAppInForeground = true
        service.webSocketKeepAlivePingOverride = {}

        service.startWebSocketKeepAliveLoop()
        XCTAssertNotNil(service.webSocketKeepAliveTask)

        await service.disconnect()

        XCTAssertNil(service.webSocketKeepAliveTask)
        XCTAssertFalse(service.isConnected)
    }

    func testWebSocketKeepAliveFailureArmsReconnect() async {
        let service = ConstellagentService()
        service.isConnected = true
        service.isInitialized = true
        service.isAppInForeground = true
        service.webSocketKeepAliveIntervalOverrideNanoseconds = 1
        service.webSocketKeepAlivePingOverride = {
            throw NWError.posix(.ECONNRESET)
        }

        service.startWebSocketKeepAliveLoop()

        for _ in 0..<1_000 {
            if service.webSocketKeepAliveTask == nil { break }
            await Task.yield()
        }

        XCTAssertNil(service.webSocketKeepAliveTask)
        XCTAssertFalse(service.isConnected)
        XCTAssertTrue(service.shouldAutoReconnectOnForeground)
        XCTAssertEqual(service.connectionRecoveryState, .retrying(attempt: 0, message: "Reconnecting..."))
        XCTAssertNil(service.lastErrorMessage)
    }

    func testForegroundProbeImmediatelyArmsReconnectForZombieSocket() async {
        let service = ConstellagentService()
        service.isConnected = true
        service.isInitialized = true
        service.isAppInForeground = true
        service.webSocketKeepAlivePingOverride = {
            throw NWError.posix(.ECONNRESET)
        }

        await service.probeForegroundConnectionIfNeeded()

        XCTAssertFalse(service.isConnected)
        XCTAssertTrue(service.shouldAutoReconnectOnForeground)
        XCTAssertEqual(service.connectionRecoveryState, .retrying(attempt: 0, message: "Reconnecting..."))
        XCTAssertNil(service.lastErrorMessage)
    }

    func testForegroundProbeTimeoutArmsReconnectWhenPingHangs() async {
        let service = ConstellagentService()
        service.isConnected = true
        service.isInitialized = true
        service.isAppInForeground = true
        service.webSocketForegroundProbeTimeoutOverrideNanoseconds = 1
        service.webSocketKeepAlivePingOverride = {
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }

        await service.probeForegroundConnectionIfNeeded()

        XCTAssertFalse(service.isConnected)
        XCTAssertTrue(service.shouldAutoReconnectOnForeground)
        XCTAssertEqual(service.connectionRecoveryState, .retrying(attempt: 0, message: "Connection timed out. Retrying..."))
        XCTAssertNil(service.lastErrorMessage)
    }

    func testBenignDisconnectStaysSilentWhileAutoReconnectIsRunning() {
        let service = ConstellagentService()
        let error = ConstellagentServiceError.disconnected
        service.isAppInForeground = true
        service.shouldAutoReconnectOnForeground = true
        service.connectionRecoveryState = .retrying(attempt: 1, message: "Connection timed out. Retrying...")

        XCTAssertTrue(service.shouldSuppressRecoverableConnectionError(error))
        XCTAssertTrue(service.shouldSuppressUserFacingConnectionError(error))
    }

    func testConnectionRefusedStillSurfacesToUser() {
        let service = ConstellagentService()
        let error = NWError.posix(.ECONNREFUSED)

        XCTAssertFalse(service.shouldSuppressUserFacingConnectionError(error))
        XCTAssertEqual(
            service.userFacingConnectError(
                error: error,
                attemptedURL: "wss://relay.example/relay/session",
                host: "relay.example"
            ),
            "Connection refused by relay server at wss://relay.example/relay/session."
        )
    }

    func testBenignBackgroundAbortGetsFriendlyFailureCopy() {
        let service = ConstellagentService()

        XCTAssertEqual(
            service.userFacingConnectFailureMessage(NWError.posix(.ECONNABORTED)),
            "Connection was interrupted. Tap Reconnect to try again."
        )
    }

    func testBrokenPipeGetsFriendlyFailureCopy() {
        let service = ConstellagentService()

        XCTAssertEqual(
            service.userFacingConnectFailureMessage(NWError.posix(.EPIPE)),
            "Connection was interrupted. Tap Reconnect to try again."
        )
    }

    func testTurnErrorSuppressesBrokenPipeWhileAutoReconnectIsRunning() {
        let service = ConstellagentService()
        let error = NWError.posix(.EPIPE)
        service.isAppInForeground = true
        service.shouldAutoReconnectOnForeground = true
        service.connectionRecoveryState = .retrying(attempt: 1, message: "Connection timed out. Retrying...")

        XCTAssertTrue(service.shouldSuppressRecoverableConnectionError(error))
        XCTAssertEqual(service.userFacingTurnErrorMessage(from: error), "")
    }

    func testCancellationErrorIsHiddenFromTurnFooter() {
        let service = ConstellagentService()

        XCTAssertEqual(service.userFacingTurnErrorMessage(from: CancellationError()), "")
        XCTAssertNil(service.userFacingTurnErrorMessageForFooter(from: CancellationError()))
        XCTAssertTrue(service.shouldSuppressRuntimeErrorInChat(CancellationError()))
    }

    func testTurnStartCancellationDoesNotAppendEmptySendError() {
        let service = ConstellagentService()
        let threadID = "thread-\(UUID().uuidString)"
        let pendingMessageID = "message-\(UUID().uuidString)"
        service.messagesByThread[threadID] = [
            ConstellagentMessage(
                id: pendingMessageID,
                threadId: threadID,
                role: .user,
                text: "hello",
                deliveryState: .pending
            )
        ]

        XCTAssertThrowsError(
            try service.handleTurnStartFailure(
                CancellationError(),
                pendingMessageId: pendingMessageID,
                threadId: threadID
            )
        )

        XCTAssertNil(service.lastErrorMessage)
        XCTAssertFalse(service.messages(for: threadID).contains { $0.text == "Send error: " })
    }

    func testConnectTimeSessionUnavailableCloseIsRetryable() {
        let service = ConstellagentService()
        let error = ConstellagentServiceError.invalidInput("WebSocket closed during connect (4002)")

        XCTAssertTrue(service.isRetryableSavedSessionConnectError(error))
        XCTAssertEqual(
            service.userFacingConnectFailureMessage(error),
            "Trying to reach your saved device. Constellagent will keep retrying. If you restarted the bridge on that device, scan the new QR code."
        )
    }

    func testManualWebSocketClosePayloadPreservesRetryableRelayCode() {
        let service = ConstellagentService()
        let closeCode = service.relayCloseCode(
            fromManualWebSocketClosePayload: Data([0x0F, 0xA2])
        )

        XCTAssertEqual(service.relayCloseCodeRawValue(closeCode), 4002)
    }

    func testManualWebSocketCloseFrameUsesRetryableRelayRecovery() async throws {
        let service = ConstellagentService()
        let connection = NWConnection(
            host: NWEndpoint.Host("localhost"),
            port: NWEndpoint.Port(rawValue: 80)!,
            using: NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        )
        service.relaySessionId = "session-\(UUID().uuidString)"
        service.relayUrl = "ws://mac.local/relay"
        service.isConnected = true
        service.isInitialized = true
        service.setForegroundState(true)
        service.manualWebSocketReadBuffer = Data([0x88, 0x02, 0x0F, 0xA2])

        let didHandleClose = try await service.drainManualWebSocketFrames(on: connection)

        XCTAssertTrue(didHandleClose)
        XCTAssertFalse(service.isConnected)
        XCTAssertFalse(service.isInitialized)
        XCTAssertTrue(service.shouldAutoReconnectOnForeground)
        XCTAssertEqual(service.connectionRecoveryState, .retrying(attempt: 0, message: "Reconnecting..."))
        XCTAssertEqual(
            service.lastErrorMessage,
            "Trying to reach your saved device. Constellagent will keep retrying. If you restarted the bridge on that device, scan the new QR code."
        )
    }

    func testLanAddressStillRequiresLocalNetworkAuthorization() {
        let service = ConstellagentService()
        let url = URL(string: "ws://192.168.1.31:9000/relay/session")!

        XCTAssertTrue(service.requiresLocalNetworkAuthorization(for: url))
        XCTAssertTrue(service.prefersDirectRelayTransport(for: url))
    }

    func testTailscaleAddressPrefersDirectRelayTransportWithoutLocalNetworkPrompt() {
        let service = ConstellagentService()
        let url = URL(string: "ws://100.122.27.82:9000/relay/session")!

        XCTAssertTrue(service.prefersDirectRelayTransport(for: url))
        XCTAssertFalse(service.requiresLocalNetworkAuthorization(for: url))
    }

    func testTailscaleMagicDNSHostPrefersDirectRelayTransportWithoutLocalNetworkPrompt() {
        let service = ConstellagentService()
        let url = URL(string: "ws://my-mac.tail-scale.ts.net:9000/relay/session")!

        XCTAssertTrue(service.prefersDirectRelayTransport(for: url))
        XCTAssertFalse(service.requiresLocalNetworkAuthorization(for: url))
    }

    func testDirectRelaySocketTimeoutRemainsRetryable() {
        let service = ConstellagentService()
        let error = ConstellagentServiceError.invalidInput(
            "Connection timed out after 12s while opening the direct relay socket."
        )

        XCTAssertTrue(service.isRecoverableTransientConnectionError(error))
        XCTAssertEqual(
            service.userFacingConnectFailureMessage(error),
            "Connection was interrupted. Tap Reconnect to try again."
        )
    }

    func testPrepareForConnectionAttemptPreservesFreshQRHandshakeState() async {
        let service = ConstellagentService()
        let payload = ConstellagentPairingQRPayload(
            v: constellagentPairingQRVersion,
            relay: "ws://100.122.27.82:9000/relay",
            sessionId: "session-123",
            macDeviceId: "mac-123",
            macIdentityPublicKey: Data(repeating: 1, count: 32).base64EncodedString(),
            expiresAt: 1_800_000_000_000
        )

        service.rememberRelayPairing(payload)
        XCTAssertEqual(service.secureConnectionState, .handshaking)

        await service.prepareForConnectionAttempt(preserveReconnectIntent: true)

        XCTAssertEqual(service.secureConnectionState, .handshaking)
    }

    func testPrepareForConnectionAttemptKeepsThreadStateWhenSocketAlreadyDropped() async {
        let service = ConstellagentService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"

        service.activeTurnIdByThread[threadID] = turnID
        service.runningThreadIDs.insert(threadID)
        service.bufferedSecureControlMessages["secureError"] = ["{\"kind\":\"secureError\",\"message\":\"stale\"}"]

        await service.prepareForConnectionAttempt(preserveReconnectIntent: true)

        XCTAssertEqual(service.activeTurnID(for: threadID), turnID)
        XCTAssertEqual(service.threadRunBadgeState(for: threadID), .running)
        XCTAssertTrue(service.bufferedSecureControlMessages.isEmpty)
    }
}

final class ContentThreadSelectionReconcilerTests: XCTestCase {
    func testThreadListSyncDoesNotAutoSelectWhileNewChatDraftIsPresented() {
        let existingThread = makeThread(id: "existing-thread")

        let result = ContentThreadSelectionReconciler.selectedThreadAfterThreadListSync(
            selectedThread: nil,
            activeThreadId: nil,
            threads: [existingThread],
            isPresentingNewChatFlow: true,
            suppressAutomaticThreadSelection: false,
            hasPendingNotificationOpen: false
        )

        XCTAssertNil(result)
    }

    func testThreadListSyncHonorsSuppressedAutomaticSelection() {
        let existingThread = makeThread(id: "existing-thread")

        let result = ContentThreadSelectionReconciler.selectedThreadAfterThreadListSync(
            selectedThread: nil,
            activeThreadId: nil,
            threads: [existingThread],
            isPresentingNewChatFlow: false,
            suppressAutomaticThreadSelection: true,
            hasPendingNotificationOpen: false
        )

        XCTAssertNil(result)
    }

    func testThreadListSyncRefreshesSelectedThreadMetadata() {
        let staleThread = makeThread(id: "thread-1", title: "Old")
        let refreshedThread = makeThread(id: "thread-1", title: "New")

        let result = ContentThreadSelectionReconciler.selectedThreadAfterThreadListSync(
            selectedThread: staleThread,
            activeThreadId: staleThread.id,
            threads: [refreshedThread],
            isPresentingNewChatFlow: false,
            suppressAutomaticThreadSelection: false,
            hasPendingNotificationOpen: false
        )

        XCTAssertEqual(result?.title, "New")
    }

    func testThreadListSyncAutoSelectsFirstThreadOnlyWhenAllowed() {
        let firstThread = makeThread(id: "thread-1")

        let result = ContentThreadSelectionReconciler.selectedThreadAfterThreadListSync(
            selectedThread: nil,
            activeThreadId: nil,
            threads: [firstThread],
            isPresentingNewChatFlow: false,
            suppressAutomaticThreadSelection: false,
            hasPendingNotificationOpen: false
        )

        XCTAssertEqual(result?.id, firstThread.id)
    }

    private func makeThread(id: String, title: String? = nil) -> ConstellagentThread {
        ConstellagentThread(id: id, title: title)
    }
}
