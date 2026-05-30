//  DropCatcher.swift
//  IslandNotch
//
//  Purpose: An always-present, AppKit-level drop target parked over the notch.
//           SwiftUI `.onDrop` on the DynamicNotch panel proved unreliable for
//           Finder file drags (the shelf target materialises mid-drag and never
//           registers as a destination). AppKit `NSDraggingDestination` handles a
//           real drag session deterministically. The window is click-through
//           except while a drag is in flight, so it never eats normal clicks.
//  Layer: Window

import AppKit
import UniformTypeIdentifiers

/// The view that actually accepts the drag. Reports dropped file URLs / images.
final class DropCatcherView: NSView {
    var onDropURLs: (([URL]) -> Void)?
    var onDropImage: ((NSImage) -> Void)?
    var onDragChange: ((Bool) -> Void)?
    /// Only intercept events (clicks *and* drags) while a drag is actually near the
    /// notch — otherwise stay transparent so normal clicks pass straight through.
    var isDragActive: () -> Bool = { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes([.fileURL, .png, .tiff])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    // Pass clicks through unless a drag is in flight.
    override func hitTest(_ point: NSPoint) -> NSView? {
        isDragActive() ? super.hitTest(point) : nil
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        onDragChange?(true)
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { .copy }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        onDragChange?(false)
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { true }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let pb = sender.draggingPasteboard
        if let urls = pb.readObjects(forClasses: [NSURL.self]) as? [URL], !urls.isEmpty {
            Log.store.debug("DropCatcher got \(urls.count) URL(s)")
            onDropURLs?(urls)
            onDragChange?(false)
            return true
        }
        if let images = pb.readObjects(forClasses: [NSImage.self]) as? [NSImage], let image = images.first {
            Log.store.debug("DropCatcher got image")
            onDropImage?(image)
            onDragChange?(false)
            return true
        }
        Log.store.debug("DropCatcher: no usable items on pasteboard")
        onDragChange?(false)
        return false
    }
}

/// Borderless, non-activating, transparent panel that hosts the catcher over the
/// notch + shelf region. Never becomes key, so it doesn't steal focus mid-drag.
final class DropCatcherWindow: NSPanel {
    let catcher: DropCatcherView

    init() {
        catcher = DropCatcherView(frame: .zero)
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 10, height: 10),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .screenSaver + 1 // just above the DynamicNotch panel
        ignoresMouseEvents = false
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        contentView = catcher
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
