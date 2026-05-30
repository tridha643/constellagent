//  ScreenshotStore+Import.swift
//  IslandNotch
//
//  Purpose: Drag/throw support. Copies an image the user dropped onto the notch
//           into the shots folder and indexes it like a capture, so the folder
//           stays the single source of truth.
//  Layer: Service

import AppKit
import Foundation
import UniformTypeIdentifiers

extension ScreenshotStore {
    /// Image file extensions we accept on drop.
    private static let importableExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "heic", "tiff", "bmp", "webp"]

    /// Imports an image file dropped onto the shelf. Returns the new entry, or
    /// nil if the file wasn't an importable image. Drops are NOT auto-copied
    /// unless the user has added `.drop` to their auto-copy sources.
    @discardableResult
    func importImage(from sourceURL: URL) async -> ScreenshotEntry? {
        guard ensureFolder() else { return nil }
        let ext = sourceURL.pathExtension.lowercased()
        guard Self.importableExtensions.contains(ext) else {
            Log.store.notice("ignored non-image drop: \(sourceURL.lastPathComponent)")
            return nil
        }

        let destination = folderURL.appendingPathComponent(makeTimestampFilename(ext: ext))
        do {
            try FileManager.default.copyItem(at: sourceURL, to: destination)
        } catch {
            Log.store.error("import copy failed: \(error.localizedDescription)")
            return nil
        }

        let entry = ScreenshotEntry(file: destination.lastPathComponent, ts: Date(), source: .drop)
        await append(entry)
        if preferences.shouldAutoCopy(.drop) {
            copyToClipboard(entry)
        }
        return entry
    }

    /// Imports raw image bytes (e.g. an image dragged from a browser, not a file)
    /// by encoding to PNG in the shots folder.
    @discardableResult
    func importImage(_ image: NSImage) async -> ScreenshotEntry? {
        guard ensureFolder() else { return nil }
        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            Log.store.error("import image -> PNG encode failed")
            return nil
        }
        let destination = folderURL.appendingPathComponent(makeTimestampFilename(ext: "png"))
        do {
            try png.write(to: destination, options: .atomic)
        } catch {
            Log.store.error("import image write failed: \(error.localizedDescription)")
            return nil
        }
        let entry = ScreenshotEntry(file: destination.lastPathComponent, ts: Date(), source: .drop)
        await append(entry)
        if preferences.shouldAutoCopy(.drop) {
            copyToClipboard(entry)
        }
        return entry
    }
}
