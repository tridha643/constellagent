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
