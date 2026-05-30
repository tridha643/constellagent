//  ConstellagentPresenceService.swift
//  IslandNotch
//
//  Purpose: Tracks whether the Constellagent desktop app is running so the notch
//           shelf only appears while the user is actively in Constellagent.
//  Layer: Service

import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class ConstellagentPresenceService {
    /// Production bundle id from desktop/electron-builder.yml.
    static let productionBundleID = "com.constellagent.app"
    static let localizedAppName = "Constellagent"

    private(set) var isRunning = false

    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    init() {
        refresh()
        let center = NSWorkspace.shared.notificationCenter
        observers = [
            center.addObserver(
                forName: NSWorkspace.didLaunchApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.refresh() },
            center.addObserver(
                forName: NSWorkspace.didTerminateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.refresh() },
        ]
    }

    func refresh() {
        let next = Self.constellagentIsRunning()
        guard next != isRunning else { return }
        isRunning = next
        Log.app.debug("Constellagent running: \(next)")
    }

    /// Matches shipped Electron builds and local `bun run dev` (Electron + localized name).
    static func constellagentIsRunning() -> Bool {
        NSWorkspace.shared.runningApplications.contains(where: isConstellagent)
    }

    static func isConstellagent(_ app: NSRunningApplication) -> Bool {
        if app.bundleIdentifier == productionBundleID {
            return app.activationPolicy == .regular
        }

        // Ignore Electron helpers (Cursor plugins, GPU/network, etc.).
        guard app.activationPolicy == .regular else { return false }

        if let path = app.executableURL?.path,
           path.contains("/constellagent/desktop")
            || path.hasSuffix("/Constellagent.app/Contents/MacOS/Constellagent")
            || path.hasSuffix("/Electron.app/Contents/MacOS/Electron") {
            return app.localizedName == localizedAppName
        }

        guard app.localizedName == localizedAppName else { return false }
        guard let bundleID = app.bundleIdentifier else { return false }
        return bundleID == "com.github.Electron"
            || bundleID.hasPrefix("com.electron.")
            || bundleID.contains("constellagent")
    }
}
