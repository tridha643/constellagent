// FILE: SidebarThreadStatusIcon.swift
// Purpose: Single metadata icon slot used by sidebar thread rows to surface
//          either fork ancestry or worktree scope. Centralizes the diff-key
//          identity that lets SwiftUI animate the swap cleanly when a row
//          flips between fork / worktree / no badge.
// Layer: View Component
// Exports: SidebarThreadStatusIcon
// Depends on: SwiftUI, ConstellagentThread, ConstellagentForkIcon, ConstellagentWorktreeIcon

import SwiftUI

struct SidebarThreadStatusIcon: View {
    let thread: ConstellagentThread
    let pointSize: CGFloat

    var body: some View {
        Group {
            icon
        }
        .id(identity)
        .frame(width: pointSize + 2, alignment: .center)
    }

    @ViewBuilder
    private var icon: some View {
        if thread.isForkedThread {
            ConstellagentForkIcon(pointSize: pointSize)
                .foregroundStyle(.secondary)
        } else if thread.isManagedWorktreeProject {
            ConstellagentWorktreeIcon(pointSize: pointSize, weight: .medium)
                .foregroundStyle(.secondary)
        }
    }

    // Stable identity so SwiftUI replaces the view when the underlying badge
    // category changes instead of trying to morph between unrelated shapes.
    private var identity: String {
        if thread.isForkedThread {
            return "fork"
        }
        if thread.isManagedWorktreeProject {
            return "worktree"
        }
        return "none"
    }
}
