// Stand-in types for features deferred from Phase 3 of the constellagent
// port (pet companion, GPT voice transcription, RevenueCat subscriptions).
//
// The plan calls for these to be re-evaluated after Phase 3 ships
// (`/Users/tri/.claude/plans/use-nia-look-into-zany-corbato.md`, section
// "Deferred from remodex"). In the meantime, the upstream remodex views
// still reference these types throughout `ContentView`, `SettingsView`,
// `TurnView`, `NewChatDraftView`, etc. Rather than rip every call site out,
// we provide empty placeholder types here so the iOS target compiles. Each
// stub is a no-op SwiftUI view, an empty `@Observable` store, or a passive
// manager — they render nothing and do nothing.
//
// To re-enable a feature, delete its stub here and re-add the corresponding
// upstream file from `CodexMobile/CodexMobile/`.

import Foundation
import SwiftUI

// MARK: - Pet companion

@Observable
@MainActor
final class PetCompanionStore {
    init() {}
}

@Observable
@MainActor
final class PetCompanionStatusStore {
    init() {}
}

struct PetCompanionStatusSyncView: View {
    var body: some View { EmptyView() }
}

struct PetCompanionOverlay: View {
    init(isInteractionEnabled: Bool, bottomExclusionHeight: CGFloat) {}
    var body: some View { EmptyView() }
}

// MARK: - GPT voice transcription

import Combine

enum ConstellagentVoiceFailureReason: Sendable, Equatable {
    case unsupported
    case recorderUnavailable
    case bridgeSessionUnsupported
    case reconnectRequired
    case macLoginRequired
    case macReauthenticationRequired
    case providerAuthenticationRejected(String?)
    case voiceSyncInProgress
    case chatGPTRequired
    case microphonePermissionRequired
    case microphoneUnavailable
    case transcriptionFailed(String?)
    case audioFileMissing
    case audioFileTooShort
    case audioFileTooLong
    case networkUnavailable
    case generic(String?)
}

struct ConstellagentVoiceRecording: Sendable {
    var url: URL { URL(fileURLWithPath: "/dev/null") }
    var durationSeconds: TimeInterval { 0 }
}

@MainActor
final class GPTVoiceTranscriptionManager: ObservableObject {
    @Published var audioLevels: [CGFloat] = []
    @Published var recordingDuration: TimeInterval = 0
    @Published var isRecording: Bool = false
    @Published var failure: ConstellagentVoiceFailureReason? = nil
    @Published var captureInvalidationID: Int = 0
    init() {}
    func startRecording() async throws {}
    func stopRecording() throws -> ConstellagentVoiceRecording? { nil }
    func cancelRecording() {}
    func resetMeteringState() {}
}

// TurnVoiceButtonPresentationBuilder + TurnVoiceRecoveryPresentationBuilder
// live in Views/Turn/Voice/TurnVoicePresentationBuilders.swift — preserved
// from upstream as pure UI mapping; they don't pull in audio plumbing.

enum ConstellagentVoiceTranscriptionPreflight {
    static let maxDurationSeconds: TimeInterval = 60
    static func check(_ args: Any...) -> ConstellagentVoiceFailureReason? { .unsupported }
}

enum ConstellagentVoiceRecoveryReason: Sendable, Equatable {
    case voiceSyncInProgress
    case reconnectRequired
}

extension ConstellagentService {
    func transcribeVoiceAudioFile(at url: URL, durationSeconds: TimeInterval) async throws -> String { "" }
    func classifyVoiceFailure(_ error: Error) -> ConstellagentVoiceFailureReason { .unsupported }
    func resolveVoiceRecoveryReason(_ reason: ConstellagentVoiceFailureReason?) -> ConstellagentVoiceFailureReason? { nil }
}

enum SubscriptionBootstrapState: Sendable, Equatable {
    case idle
    case loading
    case ready
    case failed
}

extension SubscriptionService {
    var hasAppAccess: Bool { true }
    var hasProAccess: Bool { false }
    func consumeFreeSendAttemptIfNeeded() {}
    func refreshCustomerInfoSilently() async {}
    var bootstrapState: SubscriptionBootstrapState { .ready }
}

struct GPTVoiceSetupSheet: View {
    init() {}
    var body: some View { EmptyView() }
}

struct VoiceRecordingCapsule: View {
    init(
        audioLevels: [CGFloat] = [],
        duration: TimeInterval = 0,
        onCancel: (() -> Void)? = nil
    ) {}
    var body: some View { EmptyView() }
}

// MARK: - Subscriptions

@Observable
@MainActor
final class SubscriptionService {
    init() {}
    func bootstrap() async {}
}

struct SubscriptionGateView: View {
    init() {}
    var body: some View { EmptyView() }
}

struct RevenueCatPaywallView: View {
    init() {}
    var body: some View { EmptyView() }
}

struct SubscriptionBootstrapFailureView: View {
    init() {}
    var body: some View { EmptyView() }
}

// MARK: - Terminal

struct TerminalScreen: View {
    init(preferredWorkingDirectory: String? = nil) {}
    var body: some View { EmptyView() }
}

enum ConstellagentTerminalSnapshot: Sendable {
    case idle
}

struct ConstellagentTerminalProfile: Sendable {
    static let empty = ConstellagentTerminalProfile()
}

enum ConstellagentTerminalProfileStore {
    static func load() -> ConstellagentTerminalProfile { .empty }
}

final class ConstellagentNativeSSHTerminal: @unchecked Sendable {
    init() {}
}
