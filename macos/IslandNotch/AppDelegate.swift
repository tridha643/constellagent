//  AppDelegate.swift
//  IslandNotch
//
//  Purpose: Owns the app's runtime: the status-bar item + menu, the floating
//           notch controller, the two capture hotkey paths, and the shared
//           stores. Bridges Settings toggles to the live double-⌘ event tap.
//  Layer: App

import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    // Shared, observable state (also injected into the Settings scene).
    let preferences = AppPreferences()
    let permissions = PermissionsService()
    lazy var store = ScreenshotStore(preferences: preferences)

    private lazy var notchController = NotchController(store: store, preferences: preferences)
    private let constellagentPresence = ConstellagentPresenceService()
    private let hotkeyService = HotkeyService()
    private let doubleTap = DoubleCommandTapService()
    private let menu = MenuBarMenu()
    private var statusItem: NSStatusItem?

    // MARK: Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        wireCaptureSources()
        notchController.install()
        syncNotchWithConstellagent()
        observeConstellagentPresence()

        Task { await store.bootstrap() }

        applyDoubleCommandSetting()
        observeDoubleCommandPreference()
        ensureScreenRecordingPermission()

        Log.app.debug("IslandNotch launched")
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        permissions.refresh()
        applyDoubleCommandSetting()
        // NOTE: deliberately NOT re-requesting Screen Recording here. The grant
        // only registers after a full relaunch, so CGPreflightScreenCaptureAccess()
        // keeps returning false for the rest of this session even once the user has
        // granted it — re-requesting on every activation would nag in a loop.
    }

    // MARK: Status item + menu

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(
            systemSymbolName: "camera.viewfinder",
            accessibilityDescription: "IslandNotch"
        )
        menu.onCapture = { [weak self] in self?.triggerCapture(.menu) }
        menu.onOpenSettings = { [weak self] in self?.openSettings() }
        menu.onQuit = { NSApp.terminate(nil) }
        item.menu = menu.build()
        statusItem = item
    }

    private func openSettings() {
        NSApp.activate(ignoringOtherApps: true)
        // The selector differs across macOS versions.
        if #available(macOS 14.0, *) {
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        } else {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
    }

    // MARK: Capture wiring

    private func wireCaptureSources() {
        hotkeyService.onCapture = { [weak self] source in self?.triggerCapture(source) }
        hotkeyService.start()
        doubleTap.onCapture = { [weak self] source in self?.triggerCapture(source) }
    }

    /// Single funnel for every capture path. The store decides whether to
    /// auto-copy based on the source and the user's preference.
    func triggerCapture(_ source: CaptureSource) {
        Task {
            await store.capture(source: source)
            if constellagentPresence.isRunning {
                notchController.flashNewCapture()
            }
        }
    }

    /// Screen Recording is required for `screencapture` to read real pixels (not
    /// just the wallpaper). Request it proactively at launch so IslandNotch shows
    /// up in System Settings and the user is prompted once — instead of silently
    /// saving blank captures. The grant only applies after relaunch, so this also
    /// re-checks on `applicationDidBecomeActive`.
    private func ensureScreenRecordingPermission() {
        permissions.refresh()
        guard !permissions.screenRecordingGranted else { return }
        permissions.requestScreenRecording()
    }

    // MARK: Constellagent presence

    private func syncNotchWithConstellagent() {
        notchController.setConstellagentActive(constellagentPresence.isRunning)
    }

    private func observeConstellagentPresence() {
        withObservationTracking {
            _ = constellagentPresence.isRunning
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.syncNotchWithConstellagent()
                self?.observeConstellagentPresence()
            }
        }
    }

    // MARK: Double-⌘ preference plumbing

    /// Starts/stops the event tap to match the current preference, requesting
    /// Accessibility when the user first turns it on.
    func applyDoubleCommandSetting() {
        if preferences.doubleCommandEnabled {
            if !permissions.accessibilityGranted {
                permissions.requestAccessibility()
            }
            if !doubleTap.isRunning {
                _ = doubleTap.start()
            }
        } else {
            doubleTap.stop()
        }
    }

    /// Re-applies the double-⌘ setting whenever the preference changes (e.g. the
    /// user flips the toggle in Settings). Re-arms itself after each change.
    private func observeDoubleCommandPreference() {
        withObservationTracking {
            _ = preferences.doubleCommandEnabled
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.applyDoubleCommandSetting()
                self?.observeDoubleCommandPreference()
            }
        }
    }
}
