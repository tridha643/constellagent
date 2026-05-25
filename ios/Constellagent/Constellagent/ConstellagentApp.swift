// FILE: ConstellagentApp.swift
// Purpose: App entry point + root dependency wiring.
// Layer: App
// Exports: ConstellagentApp
//
// Note: RevenueCat, PetCompanion, and Subscription wiring are deferred per
// the Phase 3 plan (`/Users/tri/.claude/plans/use-nia-look-into-zany-corbato.md`).
// Re-evaluate after Phase 3 ships.

import SwiftUI

@MainActor
@main
struct ConstellagentApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @UIApplicationDelegateAdaptor(ConstellagentAppDelegate.self) private var appDelegate
    @State private var constellagentService: ConstellagentService
    // Deferred-feature stores are still injected as environment values so
    // upstream views that look them up via @Environment don't crash with
    // "No Observable object of type X found." See ConstellagentDeferredStubs.swift.
    @State private var petCompanionStore = PetCompanionStore()
    @State private var petCompanionStatusStore = PetCompanionStatusStore()
    @State private var subscriptionService = SubscriptionService()

    init() {
        let service = ConstellagentService()
        service.configureNotifications()
        _constellagentService = State(initialValue: service)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(constellagentService)
                .environment(petCompanionStore)
                .environment(petCompanionStatusStore)
                .environment(subscriptionService)
                .onOpenURL { url in
                    Task { @MainActor in
                        guard ConstellagentService.legacyGPTLoginCallbackEnabled else {
                            return
                        }
                        await constellagentService.handleGPTLoginCallbackURL(url)
                    }
                }
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: UIApplication.didReceiveMemoryWarningNotification
                    )
                ) { _ in
                    TurnCacheManager.resetAll()
                }
                .onChange(of: scenePhase) { _, newPhase in
                    guard newPhase == .background else { return }
                    TurnCacheManager.resetAll()
                }
#if DEBUG
                .task {
                    if !AppEnvironment.relayBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        await constellagentService.debugAutoPairWithEnvironmentCodeIfPresent()
                    }
                }
#endif
        }
    }
}
