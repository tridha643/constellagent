// FILE: TurnWorktreeRouting.swift
// Purpose: Centralizes worktree path normalization and live-thread reuse decisions for TurnView.
// Layer: View Support
// Exports: TurnWorktreeRouting

import Foundation

enum TurnWorktreeRouting {
    // Canonicalizes project paths so worktree handoff/open logic compares the same absolute location.
    static func canonicalProjectPath(_ rawPath: String) -> String? {
        guard let normalizedPath = ConstellagentThreadStartProjectBinding.normalizedProjectPath(rawPath) else {
            return nil
        }

        return URL(fileURLWithPath: normalizedPath)
            .resolvingSymlinksInPath()
            .standardizedFileURL
            .path
    }

    static func comparableProjectPath(_ rawPath: String?) -> String? {
        guard let rawPath else {
            return nil
        }

        return canonicalProjectPath(rawPath) ?? ConstellagentThreadStartProjectBinding.normalizedProjectPath(rawPath)
    }

    // Prefers reopening the live thread already associated with a worktree instead of spawning another one.
    static func matchingLiveThread(
        in threads: [ConstellagentThread],
        projectPath: String,
        sort: ([ConstellagentThread]) -> [ConstellagentThread]
    ) -> ConstellagentThread? {
        let matchingLiveThreads = threads.filter { thread in
            thread.syncState == .live
                && comparableProjectPath(thread.normalizedProjectPath) == projectPath
        }

        return sort(matchingLiveThreads).first
    }
}
