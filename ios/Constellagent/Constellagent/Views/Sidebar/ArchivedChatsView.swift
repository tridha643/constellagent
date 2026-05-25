// FILE: ArchivedChatsView.swift
// Purpose: Displays locally archived chats from Settings with unarchive and delete actions.
// Layer: Settings View
// Exports: ArchivedChatsView
// Depends on: ConstellagentService, ConstellagentThread

import SwiftUI

struct ArchivedChatsView: View {
    @Environment(ConstellagentService.self) private var constellagent
    @State private var threadPendingDeletion: ConstellagentThread? = nil

    private var archivedThreads: [ConstellagentThread] {
        constellagent.threads
            .filter { $0.syncState == .archivedLocal }
            .sorted {
                let lhsDate = $0.updatedAt ?? $0.createdAt ?? .distantPast
                let rhsDate = $1.updatedAt ?? $1.createdAt ?? .distantPast
                return lhsDate > rhsDate
            }
    }

    var body: some View {
        Group {
            if archivedThreads.isEmpty {
                VStack(spacing: 12) {
                    ConstellagentIcon.image(systemName: "archivebox")
                        .font(.system(size: 36))
                        .foregroundStyle(.tertiary)
                    Text("No archived chats")
                        .font(AppFont.subheadline())
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(archivedThreads) { thread in
                        archivedRow(thread)
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Archived Chats")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            "Remove \"\(threadPendingDeletion?.displayTitle ?? "conversation")\" from this phone?",
            isPresented: Binding(
                get: { threadPendingDeletion != nil },
                set: { if !$0 { threadPendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Remove from Phone", role: .destructive) {
                if let thread = threadPendingDeletion {
                    constellagent.deleteThreadLocally(thread.id)
                }
                threadPendingDeletion = nil
            }
            Button("Cancel", role: .cancel) {
                threadPendingDeletion = nil
            }
        } message: {
            Text("This only removes the chat from Constellagent on this phone. Nothing is removed from your device or Constellagent observer.")
        }
    }

    private func archivedRow(_ thread: ConstellagentThread) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(thread.displayTitle)
                    .font(AppFont.body())
                    .lineLimit(1)

                if let date = thread.updatedAt ?? thread.createdAt {
                    Text(date, style: .relative)
                        .font(AppFont.caption())
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
        .contentShape(Rectangle())
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                threadPendingDeletion = thread
            } label: {
                Label("Remove", systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            HapticButton(action: { constellagent.unarchiveThread(thread.id) }) {
                ConstellagentIcon.menuLabel("Unarchive", systemName: "tray.and.arrow.up")
            }
            .tint(.blue)
        }
        .uiKitContextMenu {
            SidebarThreadContextMenu(
                thread: thread,
                onArchiveToggle: { constellagent.unarchiveThread(thread.id) },
                onDelete: { threadPendingDeletion = thread }
            )
            .uiMenu()
        }
    }
}
