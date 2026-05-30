//  NotchDropHandling.swift
//  IslandNotch
//
//  Purpose: Shared drag-and-drop surface for the notch shelf (expanded + compact).
//  Layer: View

import AppKit
import SwiftUI
import UniformTypeIdentifiers

enum NotchDropHandling {
    static let types: [UTType] = [
        .fileURL,
        .image,
        .png,
        .jpeg,
        .gif,
        .tiff,
        .heic,
        .webP,
        .data,
    ]

    @MainActor
    static func handle(_ providers: [NSItemProvider], store: ScreenshotStore) -> Bool {
        var handled = false
        for provider in providers {
            if loadFileURL(from: provider, store: store) {
                handled = true
            } else if loadImage(from: provider, store: store) {
                handled = true
            }
        }
        Log.store.debug("drop handled=\(handled) (\(providers.count) provider(s))")
        return handled
    }

    @MainActor
    private static func loadFileURL(from provider: NSItemProvider, store: ScreenshotStore) -> Bool {
        let identifiers = [
            UTType.fileURL.identifier,
            UTType.data.identifier,
            "public.file-url",
        ]
        guard let type = identifiers.first(where: { provider.hasItemConformingToTypeIdentifier($0) }) else {
            return false
        }
        provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
            let url: URL? = switch item {
            case let url as URL: url
            case let data as Data: URL(dataRepresentation: data, relativeTo: nil)
            case let string as String: URL(fileURLWithPath: string)
            case let nsString as NSString: URL(fileURLWithPath: nsString as String)
            default: nil
            }
            guard let url else { return }
            Task { @MainActor in await store.importImage(from: url) }
        }
        return true
    }

    @MainActor
    private static func loadImage(from provider: NSItemProvider, store: ScreenshotStore) -> Bool {
        let imageTypes: [UTType] = [.image, .png, .jpeg, .gif, .tiff, .heic, .webP]
        guard let type = imageTypes.first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) else {
            return false
        }
        provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
            guard let data, let image = NSImage(data: data) else { return }
            Task { @MainActor in await store.importImage(image) }
        }
        return true
    }
}

/// Compact notch region: invisible hit target + optional count badge + drop surface.
struct NotchCompactDropSurface: View {
    @Bindable var store: ScreenshotStore
    var onDropHoverChange: ((Bool) -> Void)?
    var onDropAccepted: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isDropTargeted = false

    var body: some View {
        NotchCompactIndicator(isDropTargeted: isDropTargeted)
            .contentShape(Rectangle())
            .onDrop(of: NotchDropHandling.types, isTargeted: $isDropTargeted) { providers in
                let accepted = NotchDropHandling.handle(providers, store: store)
                if accepted { onDropAccepted?() }
                return accepted
            }
            .onChange(of: isDropTargeted) { _, targeted in
                onDropHoverChange?(targeted)
            }
            .animation(Motion.easeOut, value: isDropTargeted)
    }
}
