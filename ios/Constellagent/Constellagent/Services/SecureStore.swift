// FILE: SecureStore.swift
// Purpose: Small Keychain wrapper for sensitive app settings.
// Layer: Service
// Exports: SecureStore, ConstellagentSecureKeys
// Depends on: Security

import Foundation
import Security

enum ConstellagentSecureKeys {
    nonisolated static let relaySessionId = "constellagent.relay.sessionId"
    nonisolated static let relayUrl = "constellagent.relay.url"
    nonisolated static let relayMacDeviceId = "constellagent.relay.macDeviceId"
    nonisolated static let relayMacIdentityPublicKey = "constellagent.relay.macIdentityPublicKey"
    nonisolated static let relayProtocolVersion = "constellagent.relay.protocolVersion"
    nonisolated static let relayLastAppliedBridgeOutboundSeq = "constellagent.relay.lastAppliedBridgeOutboundSeq"
    nonisolated static let pushDeviceToken = "constellagent.push.deviceToken"
    nonisolated static let trustedMacRegistry = "constellagent.secure.trustedMacRegistry"
    nonisolated static let currentTrustedMacDeviceId = "constellagent.secure.currentTrustedMacDeviceId"
    nonisolated static let lastTrustedMacDeviceId = "constellagent.secure.lastTrustedMacDeviceId"
    nonisolated static let phoneIdentityState = "constellagent.secure.phoneIdentityState"
    nonisolated static let messageHistoryKey = "constellagent.local.messageHistoryKey"
    nonisolated static let terminalSSHProfile = "constellagent.terminal.sshProfile"
    nonisolated static let terminalSSHPrivateKey = "constellagent.terminal.sshPrivateKey"
    nonisolated static let terminalSSHPrivateKeyPassphrase = "constellagent.terminal.sshPrivateKeyPassphrase"
    nonisolated static let terminalSSHKnownHostPrefix = "constellagent.terminal.sshKnownHost"
}

enum SecureStore {
    #if targetEnvironment(simulator)
    // The iOS 26 simulator silently rejects SecItemAdd/Copy in many host-app
    // contexts (unsigned bundles, XCTest runners). Fall back to UserDefaults
    // there so pairing/trust state can round-trip; device builds continue to
    // use Keychain exclusively.
    private static let simulatorFallback: UserDefaults = .standard
    #endif

    // Reads a UTF-8 string value from Keychain.
    nonisolated static func readString(for key: String) -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess,
           let data = result as? Data,
           let stringValue = String(data: data, encoding: .utf8) {
            return stringValue
        }

        #if targetEnvironment(simulator)
        if let data = simulatorFallback.data(forKey: simulatorKey(for: key)),
           let stringValue = String(data: data, encoding: .utf8) {
            return stringValue
        }
        return nil
        #else
        return nil
        #endif
    }

    // Reads opaque key material or encrypted payload blobs from Keychain.
    nonisolated static func readData(for key: String) -> Data? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let data = result as? Data {
            return data
        }

        #if targetEnvironment(simulator)
        return simulatorFallback.data(forKey: simulatorKey(for: key))
        #else
        return nil
        #endif
    }

    // Writes a UTF-8 string to Keychain; empty values are treated as delete.
    nonisolated static func writeString(_ value: String, for key: String) {
        writeString(value, for: key, accessibility: nil)
    }

    // Writes sensitive strings with optional Keychain accessibility constraints.
    nonisolated static func writeString(_ value: String, for key: String, accessibility: CFString?) {
        if value.isEmpty {
            deleteValue(for: key)
            return
        }

        writeData(Data(value.utf8), for: key, accessibility: accessibility)
    }

    // Stores raw data in Keychain; used by local message-history encryption keys.
    nonisolated static func writeData(_ value: Data, for key: String) {
        writeData(value, for: key, accessibility: nil)
    }

    // Stores raw data in Keychain with optional accessibility constraints for key material.
    nonisolated static func writeData(_ value: Data, for key: String, accessibility: CFString?) {
        if value.isEmpty {
            deleteValue(for: key)
            return
        }

        deleteValue(for: key)

        var query = baseQuery(for: key)
        query[kSecValueData as String] = value
        // Without an explicit accessibility class, iOS 26's stricter simulator
        // keychain silently rejects SecItemAdd; pick a device-only class so the
        // host app and XCTest runner both see the same items.
        query[kSecAttrAccessible as String] = accessibility ?? kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(query as CFDictionary, nil)
        #if targetEnvironment(simulator)
        if status != errSecSuccess {
            simulatorFallback.set(value, forKey: simulatorKey(for: key))
        } else {
            // Mirror successful writes too so reads after restart stay consistent.
            simulatorFallback.set(value, forKey: simulatorKey(for: key))
        }
        #else
        _ = status
        #endif
    }

    // Convenience wrapper for small Codable payloads kept in Keychain.
    nonisolated static func readCodable<Value: Decodable>(_ type: Value.Type, for key: String) -> Value? {
        guard let data = readData(for: key) else {
            return nil
        }
        return try? JSONDecoder().decode(type, from: data)
    }

    // Convenience wrapper for small Codable payloads kept in Keychain.
    nonisolated static func writeCodable<Value: Encodable>(_ value: Value, for key: String) {
        guard let data = try? JSONEncoder().encode(value) else {
            return
        }
        writeData(data, for: key)
    }

    nonisolated static func deleteValue(for key: String) {
        let query = baseQuery(for: key)
        SecItemDelete(query as CFDictionary)
        #if targetEnvironment(simulator)
        simulatorFallback.removeObject(forKey: simulatorKey(for: key))
        #endif
    }

    #if targetEnvironment(simulator)
    private nonisolated static func simulatorKey(for key: String) -> String {
        "constellagent.SecureStore.sim.\(key)"
    }
    #endif

    private nonisolated static func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
        ]
    }

    private nonisolated static var serviceName: String {
        Bundle.main.bundleIdentifier ?? "com.constellagentmobile.app"
    }
}
