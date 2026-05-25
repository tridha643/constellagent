// FILE: ConstellagentService+ThreadForkCompatibility.swift
// Purpose: Isolates bridge-compatibility upgrade prompts used by native thread forking.
// Layer: Service
// Exports: ConstellagentService thread-fork compatibility helpers
// Depends on: Foundation

import Foundation

extension ConstellagentService {
    // Learns that this runtime does not expose native thread forking and suppresses `/fork` for the session.
    func consumeUnsupportedThreadFork(_ error: Error) -> Bool {
        guard shouldTreatAsUnsupportedThreadFork(error) else {
            return false
        }

        markThreadForkUnsupportedForCurrentBridge()
        return true
    }

    func shouldTreatAsUnsupportedThreadFork(_ error: Error) -> Bool {
        guard let serviceError = error as? ConstellagentServiceError,
              case .rpcError(let rpcError) = serviceError else {
            return false
        }

        if rpcError.code == -32601 {
            return true
        }

        let message = rpcError.message.lowercased()
        let mentionsUnsupportedMethod = message.contains("method not found")
            || message.contains("unknown method")
            || message.contains("not implemented")
            || message.contains("does not support")
        let mentionsForkSpecificUnsupported = (message.contains("thread/fork") || message.contains("thread fork"))
            && (message.contains("unsupported") || message.contains("not supported"))

        guard rpcError.code == -32600 || rpcError.code == -32602 || rpcError.code == -32000 else {
            return mentionsUnsupportedMethod || mentionsForkSpecificUnsupported
        }

        return mentionsUnsupportedMethod || mentionsForkSpecificUnsupported
    }

    func markThreadForkUnsupportedForCurrentBridge() {
        supportsThreadFork = false

        guard !hasPresentedThreadForkBridgeUpdatePrompt else {
            return
        }

        hasPresentedThreadForkBridgeUpdatePrompt = true
        bridgeUpdatePrompt = threadForkBridgeUpdatePrompt
    }
}

private extension ConstellagentService {
    var threadForkBridgeUpdatePrompt: ConstellagentBridgeUpdatePrompt {
        ConstellagentBridgeUpdatePrompt(
            title: "Update Constellagent on your device to use /fork",
            message: "This device bridge does not support native conversation forks yet. Update the Constellagent npm package to use /fork and worktree fork flows.",
            command: "npm install -g constellagent@latest"
        )
    }
}
