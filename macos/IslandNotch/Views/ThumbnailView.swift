//  ThumbnailView.swift
//  IslandNotch
//
//  Purpose: One screenshot thumbnail. Left-click copies the payload (with a
//           "Copied" flash); right-click offers Quick Look / Reveal / Copy.
//  Layer: View

import AppKit
import SwiftUI

struct ThumbnailView: View {
    let entry: ScreenshotEntry
    @Environment(ScreenshotStore.self) private var store

    @State private var image: NSImage?
    private let side: CGFloat = 56

    private var url: URL { entry.url(in: store.folderURL) }
    private var justCopied: Bool { store.lastCopiedFileID == entry.id }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.black.opacity(0.25))
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Image(systemName: "photo")
                    .foregroundStyle(.secondary)
            }
            if justCopied {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.black.opacity(0.45))
                    .overlay {
                        Label("Copied", systemImage: "checkmark.circle.fill")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .labelStyle(.iconOnly)
                            .imageScale(.large)
                    }
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .help("Left-click: copy • Right-click: more")
        // Left-click copies for the active agent.
        .onTapGesture { store.copyToClipboard(entry) }
        // Right-click menu (includes the offline Quick Look).
        .contextMenu {
            Button("Quick Look") { QuickLookService.shared.preview(url) }
            Button("Copy for \(store.preferences.activeAgent.displayName)") {
                store.copyToClipboard(entry)
            }
            Button("Reveal in Finder") {
                NSWorkspace.shared.activateFileViewerSelecting([url])
            }
        }
        .animation(.easeInOut(duration: 0.15), value: justCopied)
        .task(id: entry.id) { await loadImage() }
    }

    private func loadImage() async {
        let fileURL = url
        // Read bytes off the main thread (Data is Sendable), decode on the main
        // actor — avoids passing a non-Sendable NSImage across actors.
        let data = await Task.detached(priority: .utility) {
            try? Data(contentsOf: fileURL)
        }.value
        if let data { image = NSImage(data: data) }
    }
}
