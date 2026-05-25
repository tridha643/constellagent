// FILE: SidebarThreadRunBadgeView.swift
// Purpose: Renders the compact run-state indicator dot for sidebar conversation rows.
// Layer: View Component
// Exports: SidebarThreadRunBadgeView
// Depends on: SwiftUI, ConstellagentThreadRunBadgeState

import SwiftUI

struct SidebarThreadRunBadgeView: View {
    let state: ConstellagentThreadRunBadgeState

    var body: some View {
        Circle()
            .fill(state.color)
            .frame(width: 10, height: 10)
            .overlay(
                Circle()
                    .stroke(Color(.systemBackground), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

private extension ConstellagentThreadRunBadgeState {
    var color: Color {
        switch self {
        case .running:
            return .blue
        case .ready:
            return .green
        case .failed:
            return .red
        }
    }
}
