// FILE: DesktopHandoffService.swift
// Purpose: Sends explicit desktop-app handoff and display-wake requests over the existing bridge connection.
// Layer: Service
// Exports: DesktopHandoffService, DesktopHandoffError
// Depends on: ConstellagentService

import Foundation

enum DesktopHandoffError: LocalizedError {
    case disconnected
    case invalidResponse
    case bridgeError(code: String?, message: String?)

    var errorDescription: String? {
        switch self {
        case .disconnected:
            return "Not connected to your paired device."
        case .invalidResponse:
            return "The desktop app did not return a valid response."
        case .bridgeError(let code, let message):
            return userMessage(for: code, fallback: message)
        }
    }

    private func userMessage(for code: String?, fallback: String?) -> String {
        DesktopHandoffError.userMessage(for: code, fallback: fallback)
    }
}

@MainActor
final class DesktopHandoffService {
    private let constellagent: ConstellagentService
    private let savedPairConnector: ((String) async throws -> Void)?

    init(
        constellagent: ConstellagentService,
        savedPairConnector: ((String) async throws -> Void)? = nil
    ) {
        self.constellagent = constellagent
        self.savedPairConnector = savedPairConnector
    }

    // Uses the platform-neutral desktop handoff RPC so the same iOS action works with macOS and Windows bridges.
    func continueOnDesktopApp(threadId: String) async throws {
        let trimmedThreadID = threadId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedThreadID.isEmpty else {
            throw DesktopHandoffError.bridgeError(
                code: "missing_thread_id",
                message: "This chat does not have a valid thread id yet."
            )
        }

        let params: JSONValue = .object([
            "threadId": .string(trimmedThreadID),
        ])

        do {
            let response = try await constellagent.sendRequest(method: "desktop/continueOnDesktop", params: params)
            guard let resultObject = response.result?.objectValue,
                  resultObject["success"]?.boolValue == true else {
                throw DesktopHandoffError.invalidResponse
            }
        } catch let error as ConstellagentServiceError {
            switch error {
            case .disconnected:
                throw DesktopHandoffError.disconnected
            case .rpcError(let rpcError):
                let errorCode = rpcError.data?.objectValue?["errorCode"]?.stringValue
                throw DesktopHandoffError.bridgeError(code: errorCode, message: rpcError.message)
            default:
                throw DesktopHandoffError.bridgeError(code: nil, message: error.errorDescription)
            }
        }
    }

    // Sends a short user-activity pulse so a saved local computer can wake its display before reconnecting.
    func wakeDisplay() async throws {
        if constellagent.isConnected {
            try await sendWakeDisplayRequest(using: constellagent)
            return
        }

        guard constellagent.canWakePreferredMacDisplay else {
            throw DesktopHandoffError.bridgeError(
                code: "saved_pair_required",
                message: "Reconnect to your paired device first."
            )
        }

        guard let reconnectURL = try await preferredReconnectURLForWake() else {
            throw DesktopHandoffError.bridgeError(
                code: "saved_pair_required",
                message: "Reconnect to your paired device or scan a new QR code first."
            )
        }

        if let savedPairConnector {
            try await savedPairConnector(reconnectURL)
        } else {
            try await constellagent.connect(
                serverURL: reconnectURL,
                token: "",
                role: "iphone",
                performInitialSync: false
            )
        }
        try await sendWakeDisplayRequest(using: constellagent)
    }

    func updateBridgeKeepMacAwakePreference(enabled: Bool) async throws {
        do {
            let response = try await constellagent.sendRequest(
                method: "desktop/preferences/update",
                params: .object([
                    "keepMacAwake": .bool(enabled),
                ])
            )
            guard let resultObject = response.result?.objectValue,
                  resultObject["success"]?.boolValue == true else {
                throw DesktopHandoffError.invalidResponse
            }
        } catch let error as ConstellagentServiceError {
            switch error {
            case .disconnected:
                throw DesktopHandoffError.disconnected
            case .rpcError(let rpcError):
                let errorCode = rpcError.data?.objectValue?["errorCode"]?.stringValue
                throw DesktopHandoffError.bridgeError(code: errorCode, message: rpcError.message)
            default:
                throw DesktopHandoffError.bridgeError(code: nil, message: error.errorDescription)
            }
        }
    }

    func updateBridgePackageAndRestart() async throws {
        do {
            let response = try await constellagent.sendRequest(
                method: "desktop/bridge/updateAndRestart",
                params: .object([:])
            )
            guard let resultObject = response.result?.objectValue,
                  resultObject["success"]?.boolValue == true else {
                throw DesktopHandoffError.invalidResponse
            }
        } catch let error as ConstellagentServiceError {
            switch error {
            case .disconnected:
                throw DesktopHandoffError.disconnected
            case .rpcError(let rpcError):
                let errorCode = rpcError.data?.objectValue?["errorCode"]?.stringValue
                throw DesktopHandoffError.bridgeError(code: errorCode, message: rpcError.message)
            default:
                throw DesktopHandoffError.bridgeError(code: nil, message: error.errorDescription)
            }
        }
    }

    // Reuses the existing JSON-RPC bridge channel so display wake follows the same secure pairing path.
    private func sendWakeDisplayRequest(using service: ConstellagentService) async throws {
        do {
            let response = try await service.sendRequest(method: "desktop/wakeDisplay", params: .object([:]))
            guard let resultObject = response.result?.objectValue,
                  resultObject["success"]?.boolValue == true else {
                throw DesktopHandoffError.invalidResponse
            }
        } catch let error as ConstellagentServiceError {
            switch error {
            case .disconnected:
                throw DesktopHandoffError.disconnected
            case .rpcError(let rpcError):
                let errorCode = rpcError.data?.objectValue?["errorCode"]?.stringValue
                throw DesktopHandoffError.bridgeError(code: errorCode, message: rpcError.message)
            default:
                throw DesktopHandoffError.bridgeError(code: nil, message: error.errorDescription)
            }
        }
    }

    // Rebuilds the last saved session URL so offline wake can use a temporary bridge connection.
    private var savedReconnectURL: String? {
        guard let sessionId = constellagent.normalizedRelaySessionId,
              let relayURL = constellagent.normalizedRelayURL else {
            return nil
        }

        return "\(relayURL)/\(sessionId)"
    }

    // Prefers a freshly resolved trusted session so display wake still works when the saved live session is gone.
    private func preferredReconnectURLForWake() async throws -> String? {
        if constellagent.hasTrustedMacReconnectCandidate {
            do {
                let resolved = try await constellagent.resolveTrustedMacSession()
                guard let relayURL = constellagent.normalizedRelayURL ?? constellagent.preferredWakeRelayURL else {
                    return nil
                }
                return "\(relayURL)/\(resolved.sessionId)"
            } catch let error as ConstellagentTrustedSessionResolveError {
                if let savedReconnectURL {
                    if case .rePairRequired = error {
                        // The saved socket handshake is the authority; resolver trust can be stale.
                        constellagent.restoreTrustedPairPresentationState()
                    }
                    constellagent.lastErrorMessage = nil
                    return savedReconnectURL
                }

                throw DesktopHandoffError.bridgeError(code: nil, message: error.localizedDescription)
            }
        }

        return savedReconnectURL
    }
}

private extension DesktopHandoffError {
    static func userMessage(for code: String?, fallback: String?) -> String {
        switch code {
        case "missing_thread_id":
            return "This chat does not have a valid thread id yet."
        case "unsupported_platform":
            return "Desktop app handoff works only when the bridge is running on a supported desktop platform."
        case "handoff_failed":
            return fallback ?? "Could not relaunch Constellagent.app on this device."
        case "wake_display_failed":
            return fallback ?? "Could not wake this device's display right now."
        case "saved_pair_required":
            return fallback ?? "Reconnect to your paired device or scan a new QR code first."
        case "unsupported_bridge_preferences":
            return fallback ?? "Update the Constellagent bridge on your device to sync this setting."
        case "invalid_bridge_preferences":
            return fallback ?? "The device bridge rejected this setting update."
        case "bridge_preferences_persist_failed":
            return fallback ?? "The device bridge could not save this setting."
        case "unsupported_bridge_update":
            return fallback ?? "Update the Constellagent bridge on your device before updating it from iPhone."
        case "bridge_update_failed":
            return fallback ?? "The device bridge could not update itself."
        default:
            return fallback ?? "Could not continue this chat on the desktop app."
        }
    }
}
