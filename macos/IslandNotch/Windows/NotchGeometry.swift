//  NotchGeometry.swift
//  IslandNotch
//
//  Purpose: Detects whether the active display has a notch and computes the
//           top-center frame for the pill fallback on non-notch Macs.
//  Layer: Window

import AppKit

enum NotchGeometry {
    /// The screen we present the notch UI on (the built-in display if present).
    static var targetScreen: NSScreen? {
        // Prefer the screen that actually has a notch; else the main screen.
        NSScreen.screens.first(where: { hasNotch($0) }) ?? NSScreen.main
    }

    /// True when `screen` physically has a notch (non-zero top safe-area inset).
    static func hasNotch(_ screen: NSScreen) -> Bool {
        if #available(macOS 12.0, *) {
            return screen.safeAreaInsets.top > 0
        }
        return false
    }

    /// The notch's screen rect in AppKit (bottom-left origin) coordinates — i.e.
    /// the same space as `NSEvent.mouseLocation`. On non-notch Macs this falls back
    /// to a top-center band the height of the menu bar.
    static func notchRect(on screen: NSScreen) -> NSRect {
        let height = max(screen.safeAreaInsets.top, screen.frame.height - screen.visibleFrame.height)
        let leftWidth = screen.auxiliaryTopLeftArea?.width ?? 0
        let rightWidth = screen.auxiliaryTopRightArea?.width ?? 0
        let notchWidth: CGFloat = {
            let computed = screen.frame.width - leftWidth - rightWidth
            return computed > 60 ? computed : 220 // fallback for non-notch / unknown
        }()
        return NSRect(
            x: screen.frame.midX - notchWidth / 2,
            y: screen.frame.maxY - height,
            width: notchWidth,
            height: height
        )
    }

    /// A generous catch zone at the top-center of the screen: wide and tall enough
    /// to (a) catch a drag approaching the closed notch and (b) fully contain the
    /// expanded shelf, so the notch stays open while the user drags *onto* it to
    /// drop instead of collapsing out from under the cursor.
    static func dragApproachRect(on screen: NSScreen) -> NSRect {
        let width: CGFloat = 660   // wider than the 600pt expanded shelf
        let height: CGFloat = 240  // notch (~38) + full expanded shelf drop area
        return NSRect(
            x: screen.frame.midX - width / 2,
            y: screen.frame.maxY - height,
            width: width,
            height: height
        )
    }

    /// Approximate menu-bar height for positioning the pill below it.
    static func menuBarHeight(for screen: NSScreen) -> CGFloat {
        screen.frame.height - screen.visibleFrame.height
            - (screen.frame.maxY - screen.visibleFrame.maxY < 0 ? 0 : 0)
    }

    /// Frame for the top-center pill fallback (no-notch Macs), pinned just under
    /// the menu bar. `size` is the desired pill size.
    static func pillFrame(on screen: NSScreen, size: CGSize) -> NSRect {
        let x = screen.frame.midX - size.width / 2
        // visibleFrame.maxY sits just below the menu bar in AppKit's flipped-up
        // coordinate space, so anchor the pill's top there.
        let y = screen.visibleFrame.maxY - size.height
        return NSRect(x: x, y: y, width: size.width, height: size.height)
    }
}
