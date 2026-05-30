//  NotchShelfView.swift
//  IslandNotch
//
//  Purpose: The expanded notch content — a horizontal strip of recent shots that
//           grows on hover, plus the drag/throw drop target for adding images.
//  Layer: View

import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct NotchShelfView: View {
    @Environment(ScreenshotStore.self) private var store
    @State private var isExpanded = false
    @State private var isDropTargeted = false

    private let maxVisible = 8

    var body: some View {
        Group {
            if store.entries.isEmpty {
                NotchPillView(count: 0)
            } else {
                shelf
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.black.opacity(0.85))
        )
        .overlay {
            if isDropTargeted { DropZoneView() }
        }
        .onHover { isExpanded = $0 }
        // Accept dragged image files (and raw images) to "throw" shots in.
        .onDrop(of: [UTType.fileURL, UTType.image], isTargeted: $isDropTargeted) { providers in
            handleDrop(providers)
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isExpanded)
        .animation(.easeInOut(duration: 0.15), value: store.entries)
    }

    private var shelf: some View {
        HStack(spacing: 8) {
            ForEach(visibleEntries) { entry in
                ThumbnailView(entry: entry)
            }
            if !isExpanded && store.entries.count > visibleEntries.count {
                Text("+\(store.entries.count - visibleEntries.count)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white.opacity(0.7))
                    .frame(width: 28)
            }
        }
    }

    /// Show fewer thumbnails when collapsed; reveal more on hover.
    private var visibleEntries: [ScreenshotEntry] {
        let limit = isExpanded ? maxVisible : 3
        return Array(store.entries.prefix(limit))
    }

    // MARK: Drop handling

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        var handled = false
        for provider in providers {
            if provider.canLoadObject(ofClass: URL.self) {
                handled = true
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    guard let url else { return }
                    Task { @MainActor in await store.importImage(from: url) }
                }
            } else if provider.canLoadObject(ofClass: NSImage.self) {
                handled = true
                _ = provider.loadObject(ofClass: NSImage.self) { object, _ in
                    guard let image = object else { return }
                    Task { @MainActor in await store.importImage(image) }
                }
            }
        }
        return handled
    }
}
