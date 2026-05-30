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

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var image: NSImage?
    @State private var isHovered = false
    @State private var isPressed = false
    private let side: CGFloat = 56

    private var url: URL { entry.url(in: store.folderURL) }
    private var justCopied: Bool { store.lastCopiedFileID == entry.id }

    /// Press wins over hover: scale down 0.96 while clicking (tactile "the UI
    /// heard you"), lift 1.05 on hover, rest at 1.0. Skipped under reduced motion.
    private var scale: CGFloat {
        if reduceMotion { return 1 }
        if isPressed { return 0.96 }
        return isHovered ? 1.05 : 1
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.black.opacity(0.25))
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    // Fade the bytes in once decoded instead of a hard pop.
                    .transition(Motion.transition(.opacity, reduceMotion: reduceMotion))
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
                    // A confirmation the user only sees on demand — let it pop.
                    .transition(Motion.transition(Motion.overlay, reduceMotion: reduceMotion))
            }

            if isHovered {
                VStack {
                    HStack {
                        Spacer()
                        Button {
                            Task { await store.delete(entry) }
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 18, height: 18)
                                .background(Circle().fill(.black.opacity(0.55)))
                        }
                        .buttonStyle(.plain)
                        .help("Delete screenshot")
                    }
                    Spacer()
                }
                .padding(4)
                .transition(Motion.transition(
                    .scale(scale: 0.8).combined(with: .opacity), reduceMotion: reduceMotion
                ))
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(.white.opacity(isHovered ? 0.28 : 0.12), lineWidth: 1)
        )
        .scaleEffect(scale)
        .contentShape(Rectangle())
        .help("Left-click: copy • Right-click: more")
        .onHover { isHovered = $0 }
        // Left-click copies for the active agent.
        .onTapGesture { store.copyToClipboard(entry) }
        // Track press purely for the scale feedback; runs alongside the tap so it
        // doesn't swallow the copy action.
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in if !isPressed { isPressed = true } }
                .onEnded { _ in isPressed = false }
        )
        // Right-click menu (includes the offline Quick Look).
        .contextMenu {
            Button("Quick Look") { QuickLookService.shared.preview(url) }
            Button("Copy for \(store.preferences.activeAgent.displayName)") {
                store.copyToClipboard(entry)
            }
            Button("Reveal in Finder") {
                NSWorkspace.shared.activateFileViewerSelecting([url])
            }
            Divider()
            Button("Delete", role: .destructive) {
                Task { await store.delete(entry) }
            }
        }
        .animation(Motion.press, value: isPressed)
        .animation(Motion.hover, value: isHovered)
        .animation(Motion.shelfItem, value: justCopied)
        .animation(Motion.easeOut, value: image != nil)
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
