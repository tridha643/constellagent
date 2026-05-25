// FILE: ConstellagentSecurePairingStateTests.swift
// Purpose: Verifies fresh QR scans force bootstrap mode and secure pairing failures stay actionable in UI state.
// Layer: Unit Test
// Exports: ConstellagentSecurePairingStateTests
// Depends on: Foundation, XCTest, Constellagent

import Foundation
import XCTest
@testable import Constellagent

@MainActor
final class ConstellagentSecurePairingStateTests: XCTestCase {
    private static var retainedServices: [ConstellagentService] = []

    override func setUp() {
        super.setUp()
        clearStoredSecureRelayState()
    }

    override func tearDown() {
        clearStoredSecureRelayState()
        super.tearDown()
    }

    func testRememberRelayPairingForcesFreshQRBootstrapEvenForTrustedMac() {
        let service = makeService()
        let macDeviceID = "mac-\(UUID().uuidString)"
        let originalPublicKey = Data(repeating: 1, count: 32).base64EncodedString()
        let freshQRPublicKey = Data(repeating: 2, count: 32).base64EncodedString()

        service.trustedMacRegistry.records[macDeviceID] = ConstellagentTrustedMacRecord(
            macDeviceId: macDeviceID,
            macIdentityPublicKey: originalPublicKey,
            lastPairedAt: Date()
        )

        service.rememberRelayPairing(
            ConstellagentPairingQRPayload(
                v: constellagentPairingQRVersion,
                relay: "ws://relay.local/relay",
                sessionId: "session-\(UUID().uuidString)",
                macDeviceId: macDeviceID,
                macIdentityPublicKey: freshQRPublicKey,
                expiresAt: Int64(Date().addingTimeInterval(60).timeIntervalSince1970 * 1000)
            )
        )

        XCTAssertTrue(service.shouldForceQRBootstrapOnNextHandshake)
        XCTAssertFalse(service.hasTrustedReconnectContext)
        XCTAssertEqual(service.secureConnectionState, .trustedMac)
        XCTAssertEqual(service.normalizedRelayMacIdentityPublicKey, freshQRPublicKey)
    }

    func testRememberRelayPairingShowsHandshakeStateForBrandNewMac() {
        let service = makeService()
        let freshQRPublicKey = Data(repeating: 4, count: 32).base64EncodedString()

        service.rememberRelayPairing(
            ConstellagentPairingQRPayload(
                v: constellagentPairingQRVersion,
                relay: "ws://relay.local/relay",
                sessionId: "session-\(UUID().uuidString)",
                macDeviceId: "mac-\(UUID().uuidString)",
                macIdentityPublicKey: freshQRPublicKey,
                expiresAt: Int64(Date().addingTimeInterval(60).timeIntervalSince1970 * 1000)
            )
        )

        XCTAssertTrue(service.shouldForceQRBootstrapOnNextHandshake)
        XCTAssertEqual(service.secureConnectionState, .handshaking)
        XCTAssertEqual(service.secureMacFingerprint, constellagentSecureFingerprint(for: freshQRPublicKey))
    }

    func testResetSecureTransportStatePreservesRePairRequiredState() {
        let service = makeService()
        service.relaySessionId = "session-\(UUID().uuidString)"
        service.relayUrl = "ws://relay.local/relay"
        service.secureConnectionState = .rePairRequired
        service.secureMacFingerprint = "ABC123"

        service.resetSecureTransportState()

        XCTAssertEqual(service.secureConnectionState, .rePairRequired)
        XCTAssertEqual(service.secureMacFingerprint, "ABC123")
    }

    func testApplyingResolvedTrustedSessionResetsReplayCursorWhenLiveSessionChanges() {
        let service = makeService()
        let macDeviceID = "mac-\(UUID().uuidString)"

        service.relaySessionId = "stale-session"
        service.relayUrl = "wss://relay.local/relay"
        service.relayMacDeviceId = macDeviceID
        service.lastAppliedBridgeOutboundSeq = 17
        SecureStore.writeString("17", for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq)

        service.applyResolvedTrustedSession(
            ConstellagentTrustedSessionResolveResponse(
                ok: true,
                macDeviceId: macDeviceID,
                macIdentityPublicKey: Data(repeating: 7, count: 32).base64EncodedString(),
                displayName: "Desk Mac",
                sessionId: "fresh-session"
            ),
            relayURL: "wss://relay.local/relay"
        )

        XCTAssertEqual(service.lastAppliedBridgeOutboundSeq, 0)
        XCTAssertEqual(
            SecureStore.readString(for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq),
            "0"
        )
    }

    func testApplyingResolvedTrustedSessionKeepsReplayCursorWhenLiveSessionIsUnchanged() {
        let service = makeService()
        let macDeviceID = "mac-\(UUID().uuidString)"

        service.relaySessionId = "same-session"
        service.relayUrl = "wss://relay.local/relay"
        service.relayMacDeviceId = macDeviceID
        service.lastAppliedBridgeOutboundSeq = 17
        SecureStore.writeString("17", for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq)

        service.applyResolvedTrustedSession(
            ConstellagentTrustedSessionResolveResponse(
                ok: true,
                macDeviceId: macDeviceID,
                macIdentityPublicKey: Data(repeating: 8, count: 32).base64EncodedString(),
                displayName: "Desk Mac",
                sessionId: "same-session"
            ),
            relayURL: "wss://relay.local/relay"
        )

        XCTAssertEqual(service.lastAppliedBridgeOutboundSeq, 17)
        XCTAssertEqual(
            SecureStore.readString(for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq),
            "17"
        )
    }

    func testTrustMacPromotesCurrentTrustedMacDeviceId() {
        let service = makeService()
        let macDeviceID = "mac-\(UUID().uuidString)"

        service.trustMac(
            deviceId: macDeviceID,
            publicKey: Data(repeating: 6, count: 32).base64EncodedString(),
            relayURL: "wss://relay.local/relay",
            displayName: "Desk Mac"
        )

        XCTAssertEqual(service.normalizedCurrentTrustedMacDeviceId, macDeviceID)
        XCTAssertEqual(
            SecureStore.readString(for: ConstellagentSecureKeys.currentTrustedMacDeviceId),
            macDeviceID
        )
    }

    func testInitializationMigratesCurrentTrustedMacDeviceIdFromRelayMacDeviceId() {
        let macDeviceID = "mac-\(UUID().uuidString)"
        let publicKey = Data(repeating: 12, count: 32).base64EncodedString()

        SecureStore.writeCodable(
            ConstellagentTrustedMacRegistry(
                records: [
                    macDeviceID: ConstellagentTrustedMacRecord(
                        macDeviceId: macDeviceID,
                        macIdentityPublicKey: publicKey,
                        lastPairedAt: Date()
                    )
                ]
            ),
            for: ConstellagentSecureKeys.trustedMacRegistry
        )
        SecureStore.writeString(macDeviceID, for: ConstellagentSecureKeys.relayMacDeviceId)

        let service = makeService()

        XCTAssertEqual(service.normalizedCurrentTrustedMacDeviceId, macDeviceID)
        XCTAssertEqual(
            SecureStore.readString(for: ConstellagentSecureKeys.currentTrustedMacDeviceId),
            macDeviceID
        )
    }

    func testInitializationDoesNotInventCurrentTrustedMacWhenLegacyPointersAreUnknown() {
        let knownMacDeviceID = "mac-\(UUID().uuidString)"

        SecureStore.writeCodable(
            ConstellagentTrustedMacRegistry(
                records: [
                    knownMacDeviceID: ConstellagentTrustedMacRecord(
                        macDeviceId: knownMacDeviceID,
                        macIdentityPublicKey: Data(repeating: 13, count: 32).base64EncodedString(),
                        lastPairedAt: Date()
                    )
                ]
            ),
            for: ConstellagentSecureKeys.trustedMacRegistry
        )
        SecureStore.writeString("mac-missing", for: ConstellagentSecureKeys.lastTrustedMacDeviceId)

        let service = makeService()

        XCTAssertNil(service.normalizedCurrentTrustedMacDeviceId)
        XCTAssertNil(SecureStore.readString(for: ConstellagentSecureKeys.currentTrustedMacDeviceId))
    }

    func testInitializationMigratesCurrentTrustedMacDeviceIdFromLastTrustedMacDeviceId() {
        let macDeviceID = "mac-\(UUID().uuidString)"
        let publicKey = Data(repeating: 14, count: 32).base64EncodedString()

        SecureStore.writeCodable(
            ConstellagentTrustedMacRegistry(
                records: [
                    macDeviceID: ConstellagentTrustedMacRecord(
                        macDeviceId: macDeviceID,
                        macIdentityPublicKey: publicKey,
                        lastPairedAt: Date()
                    )
                ]
            ),
            for: ConstellagentSecureKeys.trustedMacRegistry
        )
        SecureStore.writeString(macDeviceID, for: ConstellagentSecureKeys.lastTrustedMacDeviceId)

        let service = makeService()

        XCTAssertEqual(service.normalizedCurrentTrustedMacDeviceId, macDeviceID)
        XCTAssertEqual(
            SecureStore.readString(for: ConstellagentSecureKeys.currentTrustedMacDeviceId),
            macDeviceID
        )
    }

    func testClearSavedRelaySessionFallsBackToCurrentTrustedMacState() {
        let service = makeService()
        let macDeviceID = "mac-\(UUID().uuidString)"
        let publicKey = Data(repeating: 15, count: 32).base64EncodedString()

        service.trustedMacRegistry.records[macDeviceID] = ConstellagentTrustedMacRecord(
            macDeviceId: macDeviceID,
            macIdentityPublicKey: publicKey,
            lastPairedAt: Date(),
            relayURL: "wss://relay.local/relay"
        )
        service.setCurrentTrustedMacDeviceId(macDeviceID)
        service.relaySessionId = "saved-session"
        service.relayUrl = "wss://relay.local/relay"
        service.relayMacDeviceId = macDeviceID
        service.relayMacIdentityPublicKey = publicKey

        service.clearSavedRelaySession()

        XCTAssertEqual(service.secureConnectionState, .liveSessionUnresolved)
        XCTAssertEqual(service.secureMacFingerprint, constellagentSecureFingerprint(for: publicKey))
        XCTAssertNil(service.normalizedRelaySessionId)
    }

    func testInitializationMigratesLegacyMacScopedDefaultsIntoCurrentMacScope() throws {
        let macDeviceID = "mac-\(UUID().uuidString)"
        let suiteName = "ConstellagentSecurePairingStateTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let legacyPlanSources = try JSONEncoder().encode(["thread-1": ConstellagentPlanSessionSource.requested])
        let legacyWorktreePaths = try JSONEncoder().encode(["thread-1": "/tmp/worktree"])
        let legacyTurnTerminalStates = try JSONEncoder().encode(["turn-1": ConstellagentTurnTerminalState.completed])
        defaults.set(legacyPlanSources, forKey: ConstellagentService.planSessionSourcesDefaultsKey)
        defaults.set(legacyWorktreePaths, forKey: ConstellagentService.associatedManagedWorktreePathsDefaultsKey)
        defaults.set(["deleted-thread"], forKey: ConstellagentService.locallyDeletedThreadIDsKey)
        defaults.set(legacyTurnTerminalStates, forKey: ConstellagentService.turnTerminalStatesDefaultsKey)

        SecureStore.writeCodable(
            ConstellagentTrustedMacRegistry(
                records: [
                    macDeviceID: ConstellagentTrustedMacRecord(
                        macDeviceId: macDeviceID,
                        macIdentityPublicKey: Data(repeating: 16, count: 32).base64EncodedString(),
                        lastPairedAt: Date()
                    )
                ]
            ),
            for: ConstellagentSecureKeys.trustedMacRegistry
        )
        SecureStore.writeString(macDeviceID, for: ConstellagentSecureKeys.currentTrustedMacDeviceId)

        let service = makeService(defaults: defaults)

        XCTAssertEqual(service.planSessionSourceByThread["thread-1"], .requested)
        XCTAssertEqual(service.associatedManagedWorktreePath(for: "thread-1"), "/tmp/worktree")
        XCTAssertEqual(service.locallyDeletedThreadIDs, Set(["deleted-thread"]))
        XCTAssertEqual(service.turnTerminalState(for: "turn-1"), .completed)
        XCTAssertNil(defaults.object(forKey: ConstellagentService.planSessionSourcesDefaultsKey))
        XCTAssertNil(defaults.object(forKey: ConstellagentService.associatedManagedWorktreePathsDefaultsKey))
        XCTAssertNil(defaults.object(forKey: ConstellagentService.locallyDeletedThreadIDsKey))
        XCTAssertNil(defaults.object(forKey: ConstellagentService.turnTerminalStatesDefaultsKey))
        XCTAssertNotNil(
            defaults.data(forKey: service.macScopedDefaultsKey(ConstellagentService.planSessionSourcesDefaultsKey, macDeviceId: macDeviceID))
        )
        XCTAssertNotNil(
            defaults.data(forKey: service.macScopedDefaultsKey(ConstellagentService.associatedManagedWorktreePathsDefaultsKey, macDeviceId: macDeviceID))
        )
        XCTAssertNotNil(
            defaults.array(forKey: service.macScopedDefaultsKey(ConstellagentService.locallyDeletedThreadIDsKey, macDeviceId: macDeviceID))
        )
        XCTAssertNotNil(
            defaults.data(forKey: service.macScopedDefaultsKey(ConstellagentService.turnTerminalStatesDefaultsKey, macDeviceId: macDeviceID))
        )
    }

    // Clears the persisted relay session keys touched by secure reconnect tests.
    private func clearStoredSecureRelayState() {
        SecureStore.deleteValue(for: ConstellagentSecureKeys.relaySessionId)
        SecureStore.deleteValue(for: ConstellagentSecureKeys.relayUrl)
        SecureStore.deleteValue(for: ConstellagentSecureKeys.relayMacDeviceId)
        SecureStore.deleteValue(for: ConstellagentSecureKeys.relayMacIdentityPublicKey)
        SecureStore.deleteValue(for: ConstellagentSecureKeys.relayProtocolVersion)
        SecureStore.deleteValue(for: ConstellagentSecureKeys.relayLastAppliedBridgeOutboundSeq)
        SecureStore.deleteValue(for: ConstellagentSecureKeys.trustedMacRegistry)
        SecureStore.deleteValue(for: ConstellagentSecureKeys.currentTrustedMacDeviceId)
        SecureStore.deleteValue(for: ConstellagentSecureKeys.lastTrustedMacDeviceId)
    }

    private func makeService(defaults: UserDefaults? = nil) -> ConstellagentService {
        let resolvedDefaults: UserDefaults
        if let defaults {
            resolvedDefaults = defaults
        } else {
            let suiteName = "ConstellagentSecurePairingStateTests.\(UUID().uuidString)"
            let isolatedDefaults = UserDefaults(suiteName: suiteName) ?? .standard
            isolatedDefaults.removePersistentDomain(forName: suiteName)
            resolvedDefaults = isolatedDefaults
        }

        let service = ConstellagentService(defaults: resolvedDefaults)
        Self.retainedServices.append(service)
        return service
    }
}
