//  NotchController.swift
//  IslandNotch
//
//  Purpose: Presents the floating notch UI. Wraps DynamicNotchKit so all of the
//           borderless / non-activating NSPanel + expand-collapse animation math
//           is delegated to a maintained package. On Macs without a notch the
//           package automatically falls back to a floating top-center style.
//
//  NOTE: DynamicNotchKit's public API can shift between major versions. This file
//        is the ONLY place that touches it — if the installed version differs,
//        adjust the calls here (everything else talks to NotchController, not the
//        package). Written against the documented surface:
//            let notch = DynamicNotch { content }
//            await notch.expand()   /   await notch.hide()
//  Layer: Window

import AppKit
import DynamicNotchKit
import SwiftUI

@MainActor
final class NotchController {
    private let store: ScreenshotStore
    private let preferences: AppPreferences
    private var notch: DynamicNotch<AnyView>?

    init(store: ScreenshotStore, preferences: AppPreferences) {
        self.store = store
        self.preferences = preferences
    }

    /// Builds the notch (hosting our SwiftUI shelf) and shows it.
    func install() {
        let store = store
        let preferences = preferences
        notch = DynamicNotch {
            AnyView(
                NotchShelfView()
                    .environment(store)
                    .environment(preferences)
            )
        }
        show()
    }

    /// Expands / presents the notch.
    func show() {
        guard let notch else { return }
        Task { await notch.expand() }
    }

    /// Draws attention to a newly captured shot by (re)expanding the notch.
    func flashNewCapture() {
        show()
    }

    func hide() {
        guard let notch else { return }
        Task { await notch.hide() }
    }
}
