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
//        package). Written against DynamicNotchKit 1.1.x:
//            let notch = DynamicNotch { expanded } compactLeading: { … } compactTrailing: { … }
//            await notch.expand()   /   await notch.compact()   /   await notch.hide()
//  Layer: Window

import AppKit
import Combine
import DynamicNotchKit
import SwiftUI

@MainActor
final class NotchController {
    private let store: ScreenshotStore
    private let preferences: AppPreferences
    private var notch: DynamicNotch<AnyView, EmptyView, AnyView>?
    private var isConstellagentActive = false
    private var collapseTask: Task<Void, Never>?
    private var hoverCancellable: AnyCancellable?

    /// Global monitors that notice a drag (from any app) passing near the notch,
    /// so we can expand the shelf to meet it — `.onHover`/`.onDrop` can't see a
    /// drag until it's already over a tiny target. Pattern from NotchDrop.
    private var dragMonitor: EventMonitor?
    private var dragEndMonitor: EventMonitor?
    private var isDragNearNotch = false
    /// Armed slightly before the drag reaches the catcher window, so the catcher's
    /// hitTest is already intercepting when the drag arrives (avoids a race).
    private var isDragArmed = false
    /// Shared with the shelf so it can show a "drop here" affordance on approach.
    private let dragState = NotchDragState()
    /// AppKit-level drop target over the notch (SwiftUI `.onDrop` on the notch
    /// panel misses drags whose target appears mid-drag).
    private let dropCatcher = DropCatcherWindow()

    init(store: ScreenshotStore, preferences: AppPreferences) {
        self.store = store
        self.preferences = preferences
    }

    /// Builds the notch host. Stays hidden until Constellagent is running.
    func install() {
        guard notch == nil else { return }
        let store = store
        let preferences = preferences
        let dragState = dragState
        let notch = DynamicNotch(hoverBehavior: [.keepVisible]) {
            AnyView(
                NotchShelfView(
                    onDropHoverChange: { [weak self] targeted in
                        self?.handleDropHover(targeted)
                    },
                    onDropAccepted: { [weak self] in
                        self?.handleDropAccepted()
                    }
                )
                .environment(store)
                .environment(preferences)
                .environment(dragState)
            )
        } compactLeading: {
            EmptyView()
        } compactTrailing: {
            AnyView(
                NotchCompactDropSurface(
                    store: store,
                    onDropHoverChange: { [weak self] targeted in
                        self?.handleDropHover(targeted)
                    },
                    onDropAccepted: { [weak self] in
                        self?.handleDropAccepted()
                    }
                )
            )
        }
        self.notch = notch
        bindHoverObservation(to: notch)
        configureDropCatcher()
        startDragApproachWatch()
    }

    // MARK: AppKit drop catcher

    private func configureDropCatcher() {
        dropCatcher.catcher.isDragActive = { [weak self] in self?.isDragArmed ?? false }
        dropCatcher.catcher.onDragChange = { [weak self] active in
            Task { @MainActor in self?.setDragInbound(active) }
        }
        dropCatcher.catcher.onDropURLs = { [weak self] urls in
            Task { @MainActor in self?.importDropped(urls: urls) }
        }
        dropCatcher.catcher.onDropImage = { [weak self] image in
            Task { @MainActor in self?.importDropped(image: image) }
        }
    }

    private func positionDropCatcher() {
        guard let screen = NotchGeometry.targetScreen else { return }
        dropCatcher.setFrame(NotchGeometry.dragApproachRect(on: screen), display: false)
    }

    private func setDragInbound(_ inbound: Bool) {
        guard isConstellagentActive else { return }
        dragState.isInbound = inbound
        if inbound {
            collapseTask?.cancel()
            Task { await notch?.expand() }
        } else {
            scheduleIdleCollapse()
        }
    }

    private func importDropped(urls: [URL]) {
        Task {
            var any = false
            for url in urls where await store.importImage(from: url) != nil { any = true }
            if any { handleDropAccepted() }
        }
    }

    private func importDropped(image: NSImage) {
        Task {
            if await store.importImage(image) != nil { handleDropAccepted() }
        }
    }

    // MARK: Drag-approach detection

    /// Watches `.leftMouseDragged` globally (fires even while Finder owns a file
    /// drag) and expands the notch when the cursor enters the catch zone around it.
    private func startDragApproachWatch() {
        guard dragMonitor == nil else { return }
        dragMonitor = EventMonitor(mask: [.leftMouseDragged]) { [weak self] _ in
            Task { @MainActor in self?.evaluateDragApproach() }
        }
        dragMonitor?.start()
        // When the drag ends, drop the "near" state and let it collapse if idle.
        dragEndMonitor = EventMonitor(mask: [.leftMouseUp]) { [weak self] _ in
            Task { @MainActor in self?.endDragApproach() }
        }
        dragEndMonitor?.start()
    }

    private func evaluateDragApproach() {
        guard isConstellagentActive, let screen = NotchGeometry.targetScreen else { return }
        // Arm on a rect larger than the catcher window so the catcher's hitTest is
        // already intercepting by the time the drag reaches it.
        let armRect = NotchGeometry.dragApproachRect(on: screen).insetBy(dx: -100, dy: -100)
        let near = armRect.contains(NSEvent.mouseLocation)
        guard near != isDragNearNotch else { return }
        isDragNearNotch = near
        isDragArmed = near
        dragState.isInbound = near
        if near {
            collapseTask?.cancel()
            Task { await notch?.expand() }
        } else {
            scheduleIdleCollapse()
        }
    }

    private func endDragApproach() {
        guard isDragNearNotch else { return }
        isDragNearNotch = false
        isDragArmed = false
        dragState.isInbound = false
        scheduleIdleCollapse()
    }

    /// Collapses back to idle shortly, unless the pointer is hovering the notch.
    private func scheduleIdleCollapse() {
        collapseTask?.cancel()
        collapseTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.2))
            guard !Task.isCancelled, isConstellagentActive, let notch = self.notch else { return }
            guard !notch.isHovering, !isDragNearNotch else { return }
            await collapseToIdle()
        }
    }

    /// Shows the compact notch affordance while Constellagent is running.
    func setConstellagentActive(_ active: Bool) {
        isConstellagentActive = active
        guard notch != nil else { return }
        collapseTask?.cancel()
        if active {
            positionDropCatcher()
            dropCatcher.orderFrontRegardless()
            Task { await presentIdle() }
        } else {
            dropCatcher.orderOut(nil)
            Task { await hide() }
        }
    }

    /// Expands briefly after a new capture, then returns to idle when inactive.
    func flashNewCapture() {
        guard isConstellagentActive else { return }
        Task { await expandAndScheduleCollapse() }
    }

    func hide() async {
        collapseTask?.cancel()
        guard let notch else { return }
        await notch.hide()
    }

    // MARK: Private

    /// DynamicNotchKit hides compact mode on floating (non-notch) displays.
    private var supportsCompactIdle: Bool {
        guard let screen = NotchGeometry.targetScreen else { return false }
        return NotchGeometry.hasNotch(screen)
    }

    private func presentIdle() async {
        guard let notch, isConstellagentActive else { return }
        if supportsCompactIdle {
            await notch.compact()
        } else {
            await notch.hide()
        }
    }

    private func collapseToIdle() async {
        guard let notch, isConstellagentActive else { return }
        if supportsCompactIdle {
            await notch.compact()
        } else {
            await notch.hide()
        }
    }

    private func expandAndScheduleCollapse() async {
        guard let notch, isConstellagentActive else { return }
        collapseTask?.cancel()
        await notch.expand()
        collapseTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, isConstellagentActive, let notch = self.notch else { return }
            if notch.isHovering {
                return
            }
            await collapseToIdle()
        }
    }

    private func handleDropHover(_ targeted: Bool) {
        guard isConstellagentActive else { return }
        // The SwiftUI `.onDrop` path fires for real Finder drags once they're over
        // the target — mirror it into the inbound state so the "drop here" prompt
        // shows even if the global monitor didn't (real drag sessions can swallow
        // the global mouse events).
        dragState.isInbound = targeted
        if targeted {
            collapseTask?.cancel()
            Task { await notch?.expand() }
        }
    }

    /// A dropped image was accepted — keep the notch expanded long enough for the
    /// new thumbnail to spring in and be seen, then return to idle (same affordance
    /// as a fresh capture).
    private func handleDropAccepted() {
        guard isConstellagentActive else { return }
        dragState.isInbound = false
        Task { await expandAndScheduleCollapse() }
    }

    /// DynamicNotch publishes hover via Combine — Swift Observation does not see @Published changes.
    private func bindHoverObservation(to notch: DynamicNotch<AnyView, EmptyView, AnyView>) {
        hoverCancellable = notch.$isHovering
            .removeDuplicates()
            .receive(on: RunLoop.main)
            .sink { [weak self] hovering in
                Task { @MainActor in
                    await self?.handleHoverChange(isHovering: hovering)
                }
            }
    }

    private func handleHoverChange(isHovering: Bool) async {
        guard let notch, isConstellagentActive else { return }
        if isHovering {
            collapseTask?.cancel()
            await notch.expand()
        } else {
            collapseTask?.cancel()
            collapseTask = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled, isConstellagentActive, let notch = self.notch else { return }
                guard !notch.isHovering else { return }
                await collapseToIdle()
            }
        }
    }
}
