// FILE: ConstellagentServiceTier.swift
// Purpose: User-selectable service tier for Constellagent app-server speed controls.
// Layer: Model
// Exports: ConstellagentServiceTier
// Depends on: Foundation

import Foundation

enum ConstellagentServiceTier: String, CaseIterable, Codable, Hashable, Sendable {
    case fast

    var displayName: String {
        switch self {
        case .fast:
            return "Fast"
        }
    }

    var description: String {
        switch self {
        case .fast:
            return "Lower latency using Constellagent Fast Mode."
        }
    }

    var iconName: String {
        switch self {
        case .fast:
            return "bolt.fill"
        }
    }
}
