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
    @Environment(NotchDragState.self) private var dragState
    var onDropHoverChange: ((Bool) -> Void)?
    var onDropAccepted: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var isExpanded = false
    @State private var isDropTargeted = false
    /// Brief acknowledgement pop after a drop lands.
    @State private var acceptedPop = false

    private let maxVisible = 8

    /// Show the prominent drop affordance the moment a drag heads for the notch
    /// (`dragState.isInbound`) — not only once it's precisely over the target.
    private var showingDropZone: Bool { isDropTargeted || dragState.isInbound }

    var body: some View {
        ZStack {
            Group {
                if store.entries.isEmpty {
                    emptyDropHint
                } else {
                    shelf
                }
            }
            .opacity(showingDropZone ? 0.12 : 1) // recede behind the drop prompt

            if showingDropZone {
                DropZoneView()
                    .transition(Motion.transition(Motion.overlay, reduceMotion: reduceMotion))
            }
        }
        // Give the drop zone room to read as a real target, even with no shots yet.
        .frame(minWidth: showingDropZone ? 260 : 0, minHeight: showingDropZone ? 92 : 0)
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.black.opacity(0.85))
        )
        // A whole-shelf "pop" acknowledges that a dropped file just landed.
        .scaleEffect(acceptedPop && !reduceMotion ? 1.04 : 1.0)
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .onHover { isExpanded = $0 }
        .onDrop(of: NotchDropHandling.types, isTargeted: $isDropTargeted) { providers in
            Log.store.debug("shelf onDrop FIRED (\(providers.count) providers)")
            let accepted = NotchDropHandling.handle(providers, store: store)
            if accepted {
                onDropAccepted?()
                playAcceptedPop()
            }
            return accepted
        }
        .onChange(of: isDropTargeted) { _, targeted in
            Log.store.debug("shelf isDropTargeted=\(targeted)")
            onDropHoverChange?(targeted)
        }
        // Spring the layout (lively notch); ease-out the drop-zone overlay; spring
        // thumbnails in/out keyed on identity so a new capture animates, not every
        // unrelated state change.
        .animation(Motion.notch, value: isExpanded)
        .animation(Motion.easeOut, value: showingDropZone)
        .animation(Motion.shelfItem, value: store.entries.map(\.id))
        .animation(Motion.shelfItem, value: acceptedPop)
    }

    /// Springs the shelf up briefly then back, so a drop feels "caught".
    private func playAcceptedPop() {
        acceptedPop = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 180_000_000)
            acceptedPop = false
        }
    }

    private var emptyDropHint: some View {
        Label("Drop images here", systemImage: "square.and.arrow.down")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.65))
            .padding(.horizontal, 4)
    }

    private var shelf: some View {
        HStack(spacing: 8) {
            ForEach(visibleEntries) { entry in
                ThumbnailView(entry: entry)
                    .transition(Motion.transition(Motion.thumbnail, reduceMotion: reduceMotion))
            }
        }
    }

    /// Show fewer thumbnails when collapsed; reveal more on hover.
    private var visibleEntries: [ScreenshotEntry] {
        let limit = isExpanded ? maxVisible : 3
        return Array(store.entries.prefix(limit))
    }

}
