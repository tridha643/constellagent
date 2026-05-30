//  DoubleCommandTapService.swift
//  IslandNotch
//
//  Purpose: Detects a double-tap of the ⌘ key via a global CGEventTap and fires
//           a `.doubleCommand`-sourced capture. Requires Accessibility.
//  Layer: Service

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Listens (read-only) to `.flagsChanged` events and recognizes two clean ⌘
/// down/up cycles within a short window, with no other modifiers involved.
final class DoubleCommandTapService {
    /// Invoked on the main actor when a double-⌘ is recognized.
    var onCapture: ((CaptureSource) -> Void)?

    /// Max seconds allowed between the two ⌘ taps.
    private let doubleTapWindow: TimeInterval = 0.30

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    // Recognizer state.
    private var commandIsDown = false
    private var lastCommandUpTime: TimeInterval = 0
    private var sawForeignModifierThisCycle = false

    private(set) var isRunning = false

    // MARK: Lifecycle

    /// Installs the tap. No-op (returns false) if Accessibility isn't granted or
    /// the tap can't be created. Safe to call repeatedly.
    @discardableResult
    func start() -> Bool {
        guard !isRunning else { return true }
        guard AXIsProcessTrusted() else {
            Log.hotkey.notice("double-⌘ not started: Accessibility not granted")
            return false
        }

        let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
        let userInfo = Unmanaged.passUnretained(self).toOpaque()

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,                 // never swallow the user's ⌘
            eventsOfInterest: mask,
            callback: Self.callback,
            userInfo: userInfo
        ) else {
            Log.hotkey.error("CGEvent.tapCreate returned nil")
            return false
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        eventTap = tap
        runLoopSource = source
        isRunning = true
        Log.hotkey.debug("double-⌘ tap installed")
        return true
    }

    func stop() {
        guard isRunning else { return }
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            if let source = runLoopSource {
                CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
            }
        }
        eventTap = nil
        runLoopSource = nil
        isRunning = false
        resetCycle()
    }

    // MARK: Recognition

    private func resetCycle() {
        commandIsDown = false
        sawForeignModifierThisCycle = false
    }

    /// Handles one flagsChanged event. `flags` is the post-change modifier set.
    fileprivate func handleFlags(_ flags: CGEventFlags) {
        // Any non-⌘ modifier present disqualifies the current gesture.
        let foreign: CGEventFlags = [.maskShift, .maskAlternate, .maskControl,
                                     .maskSecondaryFn, .maskCommand]
        let nonCommand = flags.intersection(foreign.subtracting(.maskCommand))
        let commandDownNow = flags.contains(.maskCommand)

        if !nonCommand.isEmpty {
            // Another modifier is held — abandon any in-progress double-⌘.
            sawForeignModifierThisCycle = true
        }

        if commandDownNow && !commandIsDown {
            // ⌘ pressed.
            commandIsDown = true
        } else if !commandDownNow && commandIsDown {
            // ⌘ released — completes one tap (unless tainted by other modifiers).
            commandIsDown = false
            let now = ProcessInfo.processInfo.systemUptime
            defer { sawForeignModifierThisCycle = false }

            if sawForeignModifierThisCycle {
                lastCommandUpTime = 0
                return
            }
            if now - lastCommandUpTime <= doubleTapWindow {
                lastCommandUpTime = 0
                let handler = onCapture
                DispatchQueue.main.async { handler?(.doubleCommand) }
            } else {
                lastCommandUpTime = now
            }
        }
    }

    private func reEnableIfNeeded() {
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
    }

    // MARK: C callback

    private static let callback: CGEventTapCallBack = { _, type, event, userInfo in
        guard let userInfo else { return Unmanaged.passUnretained(event) }
        let service = Unmanaged<DoubleCommandTapService>.fromOpaque(userInfo).takeUnretainedValue()

        switch type {
        case .flagsChanged:
            service.handleFlags(event.flags)
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            // The system can disable a slow/old tap; re-arm it.
            service.reEnableIfNeeded()
        default:
            break
        }
        return Unmanaged.passUnretained(event)
    }
}
