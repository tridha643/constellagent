// FILE: TurnViewModel.swift
// Purpose: Owns local TurnView state and user actions while keeping UI components lightweight.
// Layer: View Model
// Exports: TurnViewModel, TurnComposerSendAvailability, TurnComposerAttachmentIntakePlan
// Depends on: SwiftUI, Observation, PhotosUI, ConstellagentService

import SwiftUI
import Observation
import PhotosUI

struct TurnComposerSendAvailability {
    let isSending: Bool
    let isConnected: Bool
    let trimmedInput: String
    let hasReadyImages: Bool
    let hasBlockingAttachmentState: Bool
    let hasSkillSelection: Bool
    let hasPluginSelection: Bool
    let hasReviewSelection: Bool
    let hasPendingReviewSelection: Bool
    let hasSubagentsSelection: Bool

    // Evaluates whether sending is allowed for the current composer state.
    var isSendDisabled: Bool {
        isSending
            || !isConnected
            || hasPendingReviewSelection
            || (
                trimmedInput.isEmpty
                    && !hasReadyImages
                    && !hasSkillSelection
                    && !hasPluginSelection
                    && !hasReviewSelection
                    && !hasSubagentsSelection
            )
            || hasBlockingAttachmentState
    }
}

struct TurnComposerAttachmentIntakePlan {
    let acceptedCount: Int
    let droppedCount: Int

    var hasOverflow: Bool {
        droppedCount > 0
    }

    // Computes how many picker items can be accepted without exceeding attachment slots.
    static func make(requestedCount: Int, remainingSlots: Int) -> TurnComposerAttachmentIntakePlan {
        let safeRequestedCount = max(0, requestedCount)
        let safeRemainingSlots = max(0, remainingSlots)
        let acceptedCount = min(safeRequestedCount, safeRemainingSlots)
        let droppedCount = safeRequestedCount - acceptedCount
        return TurnComposerAttachmentIntakePlan(acceptedCount: acceptedCount, droppedCount: droppedCount)
    }
}

struct QueuedTurnDraft: Identifiable {
    let id: String
    let text: String
    let attachments: [ConstellagentImageAttachment]
    let skillMentions: [ConstellagentTurnSkillMention]
    let mentionMentions: [ConstellagentTurnMention]
    // Preserves special send semantics, such as plan mode, while a busy thread queues locally.
    let collaborationMode: ConstellagentCollaborationModeKind?
    // Preserves the original composer state so a queued row can move back into the input intact.
    let rawInput: String
    let rawFileMentions: [TurnComposerMentionedFile]
    let rawSkillMentions: [TurnComposerMentionedSkill]
    let rawPluginMentions: [TurnComposerMentionedPlugin]
    let rawAttachments: [TurnComposerImageAttachment]
    let rawSubagentsSelectionArmed: Bool
    let createdAt: Date

    init(
        id: String,
        text: String,
        attachments: [ConstellagentImageAttachment],
        skillMentions: [ConstellagentTurnSkillMention],
        mentionMentions: [ConstellagentTurnMention] = [],
        collaborationMode: ConstellagentCollaborationModeKind?,
        rawInput: String? = nil,
        rawFileMentions: [TurnComposerMentionedFile] = [],
        rawSkillMentions: [TurnComposerMentionedSkill] = [],
        rawPluginMentions: [TurnComposerMentionedPlugin] = [],
        rawAttachments: [TurnComposerImageAttachment] = [],
        rawSubagentsSelectionArmed: Bool = false,
        createdAt: Date
    ) {
        self.id = id
        self.text = text
        self.attachments = attachments
        self.skillMentions = skillMentions
        self.mentionMentions = mentionMentions
        self.collaborationMode = collaborationMode
        self.rawInput = rawInput ?? text
        self.rawFileMentions = rawFileMentions
        self.rawSkillMentions = rawSkillMentions
        self.rawPluginMentions = rawPluginMentions
        self.rawAttachments = rawAttachments
        self.rawSubagentsSelectionArmed = rawSubagentsSelectionArmed
        self.createdAt = createdAt
    }
}

struct TurnComposerLocalDraft: Codable, Equatable, Sendable {
    let input: String
    let mentionedFiles: [TurnComposerMentionedFile]
    let mentionedSkills: [TurnComposerMentionedSkill]
    let mentionedPlugins: [TurnComposerMentionedPlugin]
    let attachments: [TurnComposerImageAttachment]
    let reviewSelection: TurnComposerReviewSelection?
    let isPlanModeArmed: Bool
    let isSubagentsSelectionArmed: Bool
    let updatedAt: Date

    nonisolated var isEmpty: Bool {
        input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && mentionedFiles.isEmpty
            && mentionedSkills.isEmpty
            && mentionedPlugins.isEmpty
            && attachments.isEmpty
            && (reviewSelection.map { _ in false } ?? true)
            && !isPlanModeArmed
            && !isSubagentsSelectionArmed
    }

    // Captures only reusable attachment states so stale loading tiles do not revive after navigation.
    static func make(
        input: String,
        mentionedFiles: [TurnComposerMentionedFile],
        mentionedSkills: [TurnComposerMentionedSkill],
        mentionedPlugins: [TurnComposerMentionedPlugin],
        attachments: [TurnComposerImageAttachment],
        reviewSelection: TurnComposerReviewSelection?,
        isPlanModeArmed: Bool,
        isSubagentsSelectionArmed: Bool,
        updatedAt: Date = Date()
    ) -> TurnComposerLocalDraft {
        let readyAttachments = attachments.compactMap { attachment -> TurnComposerImageAttachment? in
            guard case .ready = attachment.state else { return nil }
            return attachment
        }

        return TurnComposerLocalDraft(
            input: input,
            mentionedFiles: mentionedFiles,
            mentionedSkills: mentionedSkills,
            mentionedPlugins: mentionedPlugins,
            attachments: readyAttachments,
            reviewSelection: reviewSelection,
            isPlanModeArmed: isPlanModeArmed,
            isSubagentsSelectionArmed: isSubagentsSelectionArmed,
            updatedAt: updatedAt
        )
    }
}

enum QueuePauseState: Equatable {
    case active
    case paused(errorMessage: String)
}

@MainActor
@Observable
final class TurnViewModel {
    enum GitBranchUserOperation: Equatable {
        case create(String)
        case switchTo(String)
        case createWorktree(
            branchName: String,
            baseBranch: String,
            changeTransfer: GitWorktreeChangeTransferMode
        )
        case createManagedWorktree(
            baseBranch: String,
            changeTransfer: GitWorktreeChangeTransferMode
        )
    }

    // Preserves the exact composer payload + raw chips so stale-busy recovery can retry cleanly.
    private struct PendingTurnSend {
        let payload: String
        let attachments: [ConstellagentImageAttachment]
        let skillMentions: [ConstellagentTurnSkillMention]
        let mentionMentions: [ConstellagentTurnMention]
        let collaborationMode: ConstellagentCollaborationModeKind?
        let rawInput: String
        let rawFileMentions: [TurnComposerMentionedFile]
        let rawSkillMentions: [TurnComposerMentionedSkill]
        let rawPluginMentions: [TurnComposerMentionedPlugin]
        let rawAttachments: [TurnComposerImageAttachment]
        let rawReviewSelection: TurnComposerReviewSelection?
        let rawSubagentsSelectionArmed: Bool
    }

    // Splits contiguous filename segments into search-friendly word chunks.
    private static let fileMentionSegmentRegex = try? NSRegularExpression(
        pattern: #"[A-Z]+(?=$|[A-Z][a-z]|\d)|[A-Z]?[a-z]+|\d+"#
    )

    init(shouldAnchorToAssistantResponse: Bool = false) {
        self.shouldAnchorToAssistantResponse = shouldAnchorToAssistantResponse
    }

    var input = ""
    var isSending = false
    var isHandlingApproval = false
    var isPlanModeArmed = false
    var steeringDraftID: String?
    var shouldAnchorToAssistantResponse = false
    var isPhotoPickerPresented = false
    var isCameraPresented = false
    var photoPickerItems: [PhotosPickerItem] = []
    var composerAttachments: [TurnComposerImageAttachment] = []
    var composerMentionedFiles: [TurnComposerMentionedFile] = []
    var composerMentionedSkills: [TurnComposerMentionedSkill] = []
    var composerMentionedPlugins: [TurnComposerMentionedPlugin] = []
    var composerReviewSelection: TurnComposerReviewSelection?
    var isSubagentsSelectionArmed = false
    var fileAutocompleteItems: [ConstellagentFuzzyFileMatch] = []
    var isFileAutocompleteVisible = false
    var isFileAutocompleteLoading = false
    var fileAutocompleteQuery = ""
    var skillAutocompleteItems: [ConstellagentSkillMetadata] = []
    var isSkillAutocompleteVisible = false
    var isSkillAutocompleteLoading = false
    var skillAutocompleteQuery = ""
    var pluginAutocompleteItems: [ConstellagentPluginMetadata] = []
    var isPluginAutocompleteVisible = false
    var isPluginAutocompleteLoading = false
    var pluginAutocompleteQuery = ""
    var slashCommandPanelState: TurnComposerSlashCommandPanelState = .hidden
    // MARK: - Git state

    var runningGitAction: TurnGitActionKind? = nil
    // Real-time progress for the in-flight git action; drives the toast title and checklist.
    var gitActionProgress: TurnGitActionProgress? = nil
    // Brief success state shown after the action completes; carries optional CTAs (e.g. View PR).
    var gitActionSuccess: TurnGitActionSuccess? = nil
    var inlineCommitAndPushPhase: InlineCommitAndPushPhase? = nil
    var isRunningGitAction: Bool { runningGitAction != nil }
    var gitActionLoadingTitle: String? {
        gitActionProgress?.activeTitle
    }
    @ObservationIgnored private var gitActionSuccessDismissTask: Task<Void, Never>?
    var isShowingNothingToCommitAlert = false
    var gitSyncAlert: TurnGitSyncAlert? = nil
    var isLoadingGitBranchTargets = false
    var isSwitchingGitBranch = false
    var isCreatingGitWorktree = false
    var selectedGitBaseBranch = ""
    var currentGitBranch = ""
    var availableGitBranchTargets: [String] = []
    var gitBranchesCheckedOutElsewhere: Set<String> = []
    var gitWorktreePathsByBranch: [String: String] = [:]
    var gitLocalCheckoutPath: String?
    var gitDefaultBranch = ""
    var gitRepoSync: GitRepoSyncResult? = nil
    var gitSyncState: String? { gitRepoSync?.state }
    var isGitRepositoryInitialized: Bool { gitRepoSync?.isGitRepository == true }
    var disabledGitActions: Set<TurnGitActionKind> {
        var disabledActions: Set<TurnGitActionKind> = []
        if !canCreatePullRequest {
            disabledActions.insert(.createPR)
        }
        if !canCommitPushCreatePullRequest {
            disabledActions.insert(.commitPushCreatePR)
        }
        if gitRepoSync?.canPush != true {
            disabledActions.insert(.push)
        }
        if gitRepoSync?.hasPushRemote != true || !(gitRepoSync?.isDirty == true || gitRepoSync?.canPush == true) {
            disabledActions.insert(.commitAndPush)
        }
        return disabledActions
    }
    // Keeps PR creation tied to live Git state instead of chat-local remembered branch state.
    var createPullRequestValidationMessage: String? {
        guard let repoSync = gitRepoSync else {
            return "Git status is still loading. Wait a moment and retry."
        }

        let branch = (repoSync.currentBranch ?? currentGitBranch).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !branch.isEmpty else {
            return "No current branch found."
        }

        let defaultBranch = gitDefaultBranch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !defaultBranch.isEmpty else {
            return "Could not determine the repository default branch."
        }

        guard branch != defaultBranch else {
            return "Switch to a feature branch before creating a PR."
        }

        guard !repoSync.isDirty else {
            return "Commit local changes before creating a PR."
        }

        guard repoSync.hasPushRemote else {
            return "Add a Git remote before creating a PR."
        }

        guard repoSync.behindCount == 0 else {
            return "Pull remote changes before creating a PR."
        }

        return nil
    }
    var canCreatePullRequest: Bool { createPullRequestValidationMessage == nil }
    var canCommitPushCreatePullRequest: Bool {
        guard let repoSync = gitRepoSync, repoSync.isGitRepository else {
            return false
        }

        let branch = (repoSync.currentBranch ?? currentGitBranch).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !branch.isEmpty,
              !gitDefaultBranch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              repoSync.hasPushRemote,
              repoSync.behindCount == 0
        else {
            return false
        }

        return repoSync.isDirty || repoSync.aheadCount > 0 || !repoSync.isPublishedToRemote
    }
    var localSelectableGitDefaultBranch: String? {
        constellagentSelectableDefaultBranch(
            defaultBranch: gitDefaultBranch,
            availableGitBranchTargets: availableGitBranchTargets
        )
    }
    var shouldShowDiscardRuntimeChangesAndSync: Bool {
        guard let sync = gitRepoSync else { return false }
        let dangerousStates = ["dirty", "dirty_and_behind", "diverged"]
        return dangerousStates.contains(sync.state) || (sync.isDirty && sync.state == "no_upstream")
    }

    // Keeps git mutations scoped to an idle, explicitly bound local repo.
    func canRunGitAction(
        isConnected: Bool,
        isThreadRunning: Bool,
        hasGitWorkingDirectory: Bool
    ) -> Bool {
        isConnected
            && hasGitWorkingDirectory
            && !isThreadRunning
            && !isRunningGitAction
            && !isSwitchingGitBranch
            && !isCreatingGitWorktree
    }

    // Cached projected timeline to avoid re-running TurnTimelineReducer on every SwiftUI evaluation.
    var projectedMessages: [ConstellagentMessage] = []
    @ObservationIgnored private var threadActivationTask: Task<Void, Never>?

    @ObservationIgnored var fileAutocompleteDebounceTask: Task<Void, Never>?
    @ObservationIgnored var skillAutocompleteDebounceTask: Task<Void, Never>?
    @ObservationIgnored var pluginAutocompleteDebounceTask: Task<Void, Never>?
    @ObservationIgnored private var localDraftPersistenceDebounceTask: Task<Void, Never>?
    @ObservationIgnored var gitStatusRefreshTask: Task<Void, Never>?
    @ObservationIgnored var pendingGitBranchOperation: GitBranchUserOperation?
    @ObservationIgnored var pendingGitWorktreeOpenHandler: ((GitCreateWorktreeResult) -> Void)?
    @ObservationIgnored var pendingManagedGitWorktreeOpenHandler: ((GitCreateManagedWorktreeResult) -> Void)?
    @ObservationIgnored private var cachedSkillSearchIndexByRoot: [String: [TurnSkillSearchIndexEntry]] = [:]
    @ObservationIgnored private var cachedPluginSearchIndexByRoot: [String: [TurnPluginSearchIndexEntry]] = [:]
    @ObservationIgnored var unsupportedSkillsAutocompleteRoots: Set<String> = []
    @ObservationIgnored var unsupportedPluginsAutocompleteRoots: Set<String> = []
    @ObservationIgnored private var dismissedStructuredPlanPromptRequestKeys: Set<String> = []
    @ObservationIgnored private var dismissingStructuredPlanPromptRequestKeys: Set<String> = []

    let maxComposerImages = 4
    let maxFileAutocompleteItems = 6
    let maxSkillAutocompleteItems = 6
    let maxPluginAutocompleteItems = 6
    private let fileAutocompleteDebounceNanoseconds: UInt64 = 180_000_000
    private let skillAutocompleteDebounceNanoseconds: UInt64 = 180_000_000
    private let pluginAutocompleteDebounceNanoseconds: UInt64 = 180_000_000
    private let localDraftPersistenceDebounceNanoseconds: UInt64 = 650_000_000
    let gitStatusRefreshDebounceNanoseconds: UInt64 = 350_000_000

    init() {}

    // MARK: - Cached Timeline Projection

    @ObservationIgnored private var lastProjectedThreadID: String?
    @ObservationIgnored private var lastProjectionChangeToken: Int = -1

    func updateProjectedTimeline(threadID: String, messages: [ConstellagentMessage], changeToken: Int) {
        guard threadID != lastProjectedThreadID || changeToken != lastProjectionChangeToken else { return }
        lastProjectedThreadID = threadID
        lastProjectionChangeToken = changeToken
        projectedMessages = TurnTimelineReducer.project(messages: messages).messages
    }

    // MARK: - Cancellable Thread Activation

    func cancelThreadActivation() { threadActivationTask?.cancel() }

    // Cancels view-scoped async work before the chat view model disappears.
    func cancelTransientTasks() {
        threadActivationTask?.cancel()
        threadActivationTask = nil
        fileAutocompleteDebounceTask?.cancel()
        fileAutocompleteDebounceTask = nil
        skillAutocompleteDebounceTask?.cancel()
        skillAutocompleteDebounceTask = nil
        pluginAutocompleteDebounceTask?.cancel()
        pluginAutocompleteDebounceTask = nil
        localDraftPersistenceDebounceTask?.cancel()
        localDraftPersistenceDebounceTask = nil
        gitStatusRefreshTask?.cancel()
        gitStatusRefreshTask = nil
    }

    func activateThread(threadID: String, constellagent: ConstellagentService, onComplete: @escaping () -> Void) {
        threadActivationTask?.cancel()
        threadActivationTask = Task { @MainActor [weak self] in
            guard !Task.isCancelled else { return }
            let didPrepare = await constellagent.prepareThreadForDisplay(threadId: threadID)
            guard didPrepare, !Task.isCancelled, constellagent.activeThreadId == threadID else { return }
            self?.flushQueueIfPossible(constellagent: constellagent, threadID: threadID)
            onComplete()
        }
    }

    // Normalized composer input reused by send validation and turn creation.
    var trimmedComposerInput: String {
        input.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // Any loading/failed attachment must block send to avoid partial payloads.
    var hasBlockingAttachmentState: Bool {
        composerAttachments.contains(where: { $0.state == .loading || $0.state == .failed })
    }

    var readyComposerAttachments: [ConstellagentImageAttachment] {
        composerAttachments.compactMap { attachment in
            if case .ready(let value) = attachment.state {
                return value
            }
            return nil
        }
    }

    var hasReadyImages: Bool {
        !readyComposerAttachments.isEmpty
    }

    var hasComposerReviewSelection: Bool {
        composerReviewSelection?.target != nil
    }

    // Keeps queue restore disabled whenever the composer already contains something meaningful.
    var hasComposerDraftContent: Bool {
        !trimmedComposerInput.isEmpty
            || !composerAttachments.isEmpty
            || !composerMentionedFiles.isEmpty
            || !composerMentionedSkills.isEmpty
            || !composerMentionedPlugins.isEmpty
            || composerReviewSelection != nil
            || isSubagentsSelectionArmed
            || isPlanModeArmed
    }

    // Allows only one queued row at a time to move back into the composer.
    var canRestoreQueuedDrafts: Bool {
        !isSending
            && steeringDraftID == nil
            && !hasComposerDraftContent
    }

    var hasPendingComposerReviewSelection: Bool {
        composerReviewSelection != nil && composerReviewSelection?.target == nil
    }

    var hasComposerContentConflictingWithReview: Bool {
        TurnComposerCommandLogic.hasContentConflictingWithReview(
            trimmedInput: trimmedComposerInput,
            mentionedFileCount: composerMentionedFiles.count,
            mentionedSkillCount: composerMentionedSkills.count,
            attachmentCount: composerAttachments.count,
            hasSubagentsSelection: isSubagentsSelectionArmed
        )
    }

    var remainingAttachmentSlots: Int {
        max(0, maxComposerImages - composerAttachments.count)
    }

    func queuedCount(constellagent: ConstellagentService, threadID: String) -> Int {
        queuedDrafts(constellagent: constellagent, threadID: threadID).count
    }

    func isQueuePaused(constellagent: ConstellagentService, threadID: String) -> Bool {
        if case .paused = queuePauseState(constellagent: constellagent, threadID: threadID) {
            return true
        }
        return false
    }

    func queuedDraftsList(constellagent: ConstellagentService, threadID: String) -> [QueuedTurnDraft] {
        queuedDrafts(constellagent: constellagent, threadID: threadID)
    }

    func removeQueuedDraft(id: String, constellagent: ConstellagentService, threadID: String) {
        var drafts = queuedDrafts(constellagent: constellagent, threadID: threadID)
        drafts.removeAll { $0.id == id }
        setQueuedDrafts(drafts, constellagent: constellagent, threadID: threadID)
    }

    // Moves one queued row back into the composer so the user can edit/resend it manually.
    func restoreQueuedDraftToComposer(id: String, constellagent: ConstellagentService, threadID: String) {
        guard canRestoreQueuedDrafts else {
            return
        }

        var drafts = queuedDrafts(constellagent: constellagent, threadID: threadID)
        guard let draftIndex = drafts.firstIndex(where: { $0.id == id }) else {
            return
        }

        let draft = drafts.remove(at: draftIndex)
        setQueuedDrafts(drafts, constellagent: constellagent, threadID: threadID)
        restoreComposerState(from: draft)
        clearComposerAutocomplete()
        shouldAnchorToAssistantResponse = false
    }

    func isSteeringQueuedDraft(_ draftID: String) -> Bool {
        steeringDraftID == draftID
    }

    func queuePauseMessage(constellagent: ConstellagentService, threadID: String) -> String? {
        if case .paused(let errorMessage) = queuePauseState(constellagent: constellagent, threadID: threadID) {
            return errorMessage
        }
        return nil
    }

    func isComposerInteractionLocked(activeTurnID: String?) -> Bool {
        _ = activeTurnID
        return isSending
    }

    func isSendDisabled(isConnected: Bool, activeTurnID: String?) -> Bool {
        _ = activeTurnID
        return TurnComposerSendAvailability(
            isSending: isSending,
            isConnected: isConnected,
            trimmedInput: trimmedComposerInput,
            hasReadyImages: hasReadyImages,
            hasBlockingAttachmentState: hasBlockingAttachmentState,
            hasSkillSelection: !composerMentionedSkills.isEmpty,
            hasPluginSelection: !composerMentionedPlugins.isEmpty,
            hasReviewSelection: hasComposerReviewSelection,
            hasPendingReviewSelection: hasPendingComposerReviewSelection,
            hasSubagentsSelection: isSubagentsSelectionArmed
        ).isSendDisabled
    }

    func clearComposer() {
        resetFileAutocompleteState()
        resetSkillAutocompleteState()
        resetPluginAutocompleteState()
        resetSlashCommandState(clearPendingSelection: true, clearConfirmedSelection: true)
        isSubagentsSelectionArmed = false
        input = ""
        composerAttachments.removeAll()
        composerMentionedFiles.removeAll()
        composerMentionedSkills.removeAll()
        composerMentionedPlugins.removeAll()
    }

    func localDraftSnapshot() -> TurnComposerLocalDraft {
        TurnComposerLocalDraft.make(
            input: input,
            mentionedFiles: composerMentionedFiles,
            mentionedSkills: composerMentionedSkills,
            mentionedPlugins: composerMentionedPlugins,
            attachments: composerAttachments,
            reviewSelection: composerReviewSelection,
            isPlanModeArmed: isPlanModeArmed,
            isSubagentsSelectionArmed: isSubagentsSelectionArmed
        )
    }

    // Saves the current composer as a per-thread draft; empty composers remove stale draft state.
    func saveLocalDraft(constellagent: ConstellagentService, threadID: String, persistToDisk: Bool = false) {
        let draft = localDraftSnapshot()
        if isSending, draft.isEmpty {
            if persistToDisk {
                flushLocalDraftPersistence(constellagent: constellagent)
            }
            return
        }

        constellagent.setComposerDraft(draft.isEmpty ? nil : draft, for: threadID)
        if persistToDisk {
            flushLocalDraftPersistence(constellagent: constellagent)
        } else {
            scheduleLocalDraftPersistence(constellagent: constellagent)
        }
    }

    func clearLocalDraft(constellagent: ConstellagentService, threadID: String, persistToDisk: Bool = false) {
        constellagent.setComposerDraft(nil, for: threadID)
        if persistToDisk {
            flushLocalDraftPersistence(constellagent: constellagent)
        } else {
            scheduleLocalDraftPersistence(constellagent: constellagent)
        }
    }

    func restoreSavedLocalDraftIfNeeded(constellagent: ConstellagentService, threadID: String) {
        guard !hasComposerDraftContent,
              let draft = constellagent.composerDraft(for: threadID),
              !draft.isEmpty else {
            return
        }

        restoreComposerState(from: draft)
    }

    // Debounces disk writes so removals and edits update persistence without writing per keystroke.
    func scheduleLocalDraftPersistence(constellagent: ConstellagentService) {
        localDraftPersistenceDebounceTask?.cancel()
        localDraftPersistenceDebounceTask = Task { @MainActor [weak self, weak constellagent] in
            guard let self, let constellagent else { return }

            do {
                try await Task.sleep(nanoseconds: localDraftPersistenceDebounceNanoseconds)
            } catch {
                return
            }

            guard !Task.isCancelled else { return }
            constellagent.persistComposerDrafts()
            self.localDraftPersistenceDebounceTask = nil
        }
    }

    // Forces pending draft state to disk before disappear/background/send boundaries.
    func flushLocalDraftPersistence(constellagent: ConstellagentService) {
        localDraftPersistenceDebounceTask?.cancel()
        localDraftPersistenceDebounceTask = nil
        constellagent.persistComposerDrafts()
    }

    // Appends spoken text into the composer without sending it automatically.
    func appendVoiceTranscript(_ transcript: String) {
        let normalizedTranscript = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedTranscript.isEmpty else {
            return
        }

        if input.isEmpty {
            input = normalizedTranscript
            return
        }

        if input.last?.isWhitespace == true {
            input += normalizedTranscript
        } else {
            input += " \(normalizedTranscript)"
        }
    }

    func setPlanModeArmed(_ isArmed: Bool) {
        isPlanModeArmed = isArmed
    }

    func clearFileAutocomplete() {
        resetFileAutocompleteState()
    }

    func clearSkillAutocomplete() {
        resetSkillAutocompleteState()
    }

    func clearPluginAutocomplete() {
        resetPluginAutocompleteState()
    }

    func clearComposerAutocomplete() {
        resetFileAutocompleteState()
        resetSkillAutocompleteState()
        resetPluginAutocompleteState()
        resetSlashCommandState(clearPendingSelection: true)
    }

    // Dismisses only the transient slash-command picker without touching confirmed composer chips.
    func closeSlashCommandPanel() {
        resetSlashCommandState(clearPendingSelection: true)
    }

    // Clears the transient slash token before routing the user into another composer flow.
    func prepareForThreadRerouteFromSlashCommand() {
        removeTrailingSlashCommandTokenFromInputIfNeeded()
        resetSlashCommandState(clearPendingSelection: true)
    }

    // Applies one-shot composer state that a fresh thread should show on first open.
    func applyPendingComposerAction(_ action: ConstellagentPendingThreadComposerAction) {
        switch action {
        case .codeReview(let target):
            armCodeReviewSelection(
                command: .codeReview,
                target: Self.turnComposerReviewTarget(for: target)
            )
        }
    }

    func removeComposerAttachment(id: String) {
        composerAttachments.removeAll(where: { $0.id == id })
    }

    // Debounces server-side fuzzy search when input ends with a valid `@query` token.
    func onInputChangedForFileAutocomplete(
        _ text: String,
        constellagent: ConstellagentService,
        thread: ConstellagentThread,
        activeTurnID: String?
    ) {
        guard !isComposerInteractionLocked(activeTurnID: activeTurnID),
              constellagent.isConnected,
              let root = normalizedAutocompleteRoot(for: thread),
              let token = Self.trailingFileAutocompleteToken(in: text) else {
            resetFileAutocompleteState()
            return
        }

        // Keeps a confirmed `@file` mention closed once the user resumes normal prose after it.
        guard !Self.hasClosedConfirmedFileMentionPrefix(
            in: text,
            confirmedMentions: composerMentionedFiles
        ) else {
            resetFileAutocompleteState()
            return
        }

        // Keep one autocomplete namespace visible at a time.
        resetSkillAutocompleteState()
        resetSlashCommandState(clearPendingSelection: true)

        let query = token.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 1 else {
            fileAutocompleteDebounceTask?.cancel()
            fileAutocompleteDebounceTask = nil
            fileAutocompleteItems = []
            fileAutocompleteQuery = query
            isFileAutocompleteLoading = false
            isFileAutocompleteVisible = false
            return
        }

        fileAutocompleteQuery = query
        isFileAutocompleteVisible = true
        isFileAutocompleteLoading = true
        fileAutocompleteDebounceTask?.cancel()

        let searchRoots = [root]
        let expectedQuery = query
        let cancellationToken = fileAutocompleteCancellationToken(for: thread.id)

        fileAutocompleteDebounceTask = Task { @MainActor [weak self] in
            guard let self else { return }

            do {
                try await Task.sleep(nanoseconds: fileAutocompleteDebounceNanoseconds)
            } catch {
                return
            }

            guard !Task.isCancelled else { return }

            do {
                let matches = try await constellagent.fuzzyFileSearch(
                    query: expectedQuery,
                    roots: searchRoots,
                    cancellationToken: cancellationToken
                )
                guard !Task.isCancelled else { return }

                // Drops stale responses if the user already typed another query.
                guard self.fileAutocompleteQuery == expectedQuery else { return }

                self.fileAutocompleteItems = Array(matches.prefix(self.maxFileAutocompleteItems))
                self.isFileAutocompleteLoading = false
                self.isFileAutocompleteVisible = true
            } catch {
                guard self.fileAutocompleteQuery == expectedQuery else { return }
                self.fileAutocompleteItems = []
                self.isFileAutocompleteLoading = false
                self.isFileAutocompleteVisible = false
            }
        }
    }

    // Debounces skill suggestions when input ends with a valid `$query` token.
    func onInputChangedForSkillAutocomplete(
        _ text: String,
        constellagent: ConstellagentService,
        thread: ConstellagentThread,
        activeTurnID: String?
    ) {
        guard !isComposerInteractionLocked(activeTurnID: activeTurnID),
              constellagent.isConnected,
              let token = Self.trailingSkillAutocompleteToken(in: text) else {
            resetSkillAutocompleteState()
            return
        }

        // Keep one autocomplete namespace visible at a time.
        resetFileAutocompleteState()
        resetPluginAutocompleteState()
        resetSlashCommandState(clearPendingSelection: true)

        let query = token.query.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedRoot = normalizedAutocompleteRoot(for: thread)
        let cacheKey = autocompleteCacheKey(forRoot: normalizedRoot)
        skillAutocompleteQuery = query
        let hasCachedSkillIndex = cachedSkillSearchIndexByRoot[cacheKey] != nil
        let rootIsUnsupported = unsupportedSkillsAutocompleteRoots.contains(cacheKey)
        isSkillAutocompleteLoading = !hasCachedSkillIndex && !rootIsUnsupported
        if let cachedIndex = cachedSkillSearchIndexByRoot[cacheKey] {
            skillAutocompleteItems = filteredSkillAutocompleteItems(for: query, indexedSkills: cachedIndex)
            isSkillAutocompleteVisible = !skillAutocompleteItems.isEmpty
        } else {
            skillAutocompleteItems = []
            isSkillAutocompleteVisible = isSkillAutocompleteLoading
        }
        skillAutocompleteDebounceTask?.cancel()

        let expectedQuery = query

        skillAutocompleteDebounceTask = Task { @MainActor [weak self] in
            guard let self else { return }

            do {
                try await Task.sleep(nanoseconds: skillAutocompleteDebounceNanoseconds)
            } catch {
                return
            }

            guard !Task.isCancelled else { return }

            do {
                if unsupportedSkillsAutocompleteRoots.contains(cacheKey),
                   cachedSkillSearchIndexByRoot[cacheKey] == nil {
                    guard self.skillAutocompleteQuery == expectedQuery else { return }
                    self.skillAutocompleteItems = []
                    self.isSkillAutocompleteLoading = false
                    self.isSkillAutocompleteVisible = false
                    return
                }

                let indexedSkills: [TurnSkillSearchIndexEntry]
                if let cachedIndex = self.cachedSkillSearchIndexByRoot[cacheKey] {
                    indexedSkills = cachedIndex
                } else {
                    let listedSkills = try await constellagent.listSkills(
                        cwds: normalizedRoot.map { [$0] },
                        forceReload: false
                    )
                    guard !Task.isCancelled else { return }
                    indexedSkills = listedSkills
                        .filter { $0.enabled }
                        .map(TurnSkillSearchIndexEntry.init(skill:))
                    self.cachedSkillSearchIndexByRoot[cacheKey] = indexedSkills
                }

                guard !Task.isCancelled else { return }
                guard self.skillAutocompleteQuery == expectedQuery else { return }

                self.skillAutocompleteItems = self.filteredSkillAutocompleteItems(
                    for: expectedQuery,
                    indexedSkills: indexedSkills
                )
                self.isSkillAutocompleteLoading = false
                self.isSkillAutocompleteVisible = !self.skillAutocompleteItems.isEmpty
            } catch {
                guard self.skillAutocompleteQuery == expectedQuery else { return }

                if Self.isMethodNotFoundRPCError(error) {
                    self.unsupportedSkillsAutocompleteRoots.insert(cacheKey)
                }

                self.skillAutocompleteItems = []
                self.isSkillAutocompleteLoading = false
                self.isSkillAutocompleteVisible = false
            }
        }
    }

    // Debounces installed Constellagent plugin suggestions for `@plugin` composer mentions.
    func onInputChangedForPluginAutocomplete(
        _ text: String,
        constellagent: ConstellagentService,
        thread: ConstellagentThread,
        activeTurnID: String?
    ) {
        guard !isComposerInteractionLocked(activeTurnID: activeTurnID),
              constellagent.isConnected,
              let root = normalizedAutocompleteRoot(for: thread),
              let token = Self.trailingPluginAutocompleteToken(in: text) else {
            resetPluginAutocompleteState()
            return
        }

        resetSkillAutocompleteState()
        resetSlashCommandState(clearPendingSelection: true)

        let query = token.query.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedRoot = root
        pluginAutocompleteQuery = query
        isPluginAutocompleteVisible = true
        let hasCachedPluginIndex = cachedPluginSearchIndexByRoot[normalizedRoot] != nil
        let rootIsUnsupported = unsupportedPluginsAutocompleteRoots.contains(normalizedRoot)
        isPluginAutocompleteLoading = !hasCachedPluginIndex && !rootIsUnsupported
        if let cachedIndex = cachedPluginSearchIndexByRoot[normalizedRoot] {
            pluginAutocompleteItems = filteredPluginAutocompleteItems(for: query, indexedPlugins: cachedIndex)
            isPluginAutocompleteVisible = !pluginAutocompleteItems.isEmpty
        } else {
            pluginAutocompleteItems = []
        }
        pluginAutocompleteDebounceTask?.cancel()

        let expectedQuery = query

        pluginAutocompleteDebounceTask = Task { @MainActor [weak self] in
            guard let self else { return }

            do {
                try await Task.sleep(nanoseconds: pluginAutocompleteDebounceNanoseconds)
            } catch {
                return
            }

            guard !Task.isCancelled else { return }

            do {
                if unsupportedPluginsAutocompleteRoots.contains(normalizedRoot),
                   cachedPluginSearchIndexByRoot[normalizedRoot] == nil {
                    guard self.pluginAutocompleteQuery == expectedQuery else { return }
                    self.pluginAutocompleteItems = []
                    self.isPluginAutocompleteLoading = false
                    self.isPluginAutocompleteVisible = false
                    return
                }

                let indexedPlugins: [TurnPluginSearchIndexEntry]
                if let cachedIndex = self.cachedPluginSearchIndexByRoot[normalizedRoot] {
                    indexedPlugins = cachedIndex
                } else {
                    let listedPlugins = try await constellagent.listPlugins(cwds: [normalizedRoot], forceReload: false)
                    guard !Task.isCancelled else { return }
                    indexedPlugins = listedPlugins
                        .map(TurnPluginSearchIndexEntry.init(plugin:))
                    self.cachedPluginSearchIndexByRoot[normalizedRoot] = indexedPlugins
                }

                guard !Task.isCancelled else { return }
                guard self.pluginAutocompleteQuery == expectedQuery else { return }

                self.pluginAutocompleteItems = self.filteredPluginAutocompleteItems(
                    for: expectedQuery,
                    indexedPlugins: indexedPlugins
                )
                self.isPluginAutocompleteLoading = false
                self.isPluginAutocompleteVisible = !self.pluginAutocompleteItems.isEmpty
            } catch {
                guard self.pluginAutocompleteQuery == expectedQuery else { return }

                if Self.isMethodNotFoundRPCError(error) {
                    self.unsupportedPluginsAutocompleteRoots.insert(normalizedRoot)
                }

                self.pluginAutocompleteItems = []
                self.isPluginAutocompleteLoading = false
                self.isPluginAutocompleteVisible = false
            }
        }
    }

    // Replaces `@query` with `@filename` in text and adds chip above input.
    func onSelectFileAutocomplete(_ item: ConstellagentFuzzyFileMatch) {
        clearComposerReviewSelectionIfNeededForNonReviewContent()

        let fullPath = item.path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? item.fileName
            : item.path

        // Replace @query with @filename inline in the text.
        if let updatedInput = Self.replacingTrailingFileAutocompleteToken(
            in: input, with: item.fileName
        ) {
            input = updatedInput
        }

        if !composerMentionedFiles.contains(where: { $0.path == fullPath }) {
            composerMentionedFiles.append(
                TurnComposerMentionedFile(fileName: item.fileName, path: fullPath)
            )
        }
        resetFileAutocompleteState()
    }

    // Replaces `@query` with `@plugin` and stores the app-server mention item for turn/start.
    func onSelectPluginAutocomplete(_ plugin: ConstellagentPluginMetadata) {
        clearComposerReviewSelectionIfNeededForNonReviewContent()

        let normalizedPluginName = plugin.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedMentionPath = plugin.mentionPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedPluginName.isEmpty, !normalizedMentionPath.isEmpty else {
            resetPluginAutocompleteState()
            return
        }

        if let updatedInput = Self.replacingTrailingPluginAutocompleteToken(
            in: input,
            with: normalizedPluginName
        ) {
            input = updatedInput
        }

        if !composerMentionedPlugins.contains(where: { $0.path == normalizedMentionPath }) {
            composerMentionedPlugins.append(
                TurnComposerMentionedPlugin(
                    name: normalizedPluginName,
                    path: normalizedMentionPath,
                    displayName: plugin.displayName
                )
            )
        }

        resetPluginAutocompleteState()
    }

    // Replaces `$query` with `$skill` and stores the selected skill mention for turn/start.
    func onSelectSkillAutocomplete(_ skill: ConstellagentSkillMetadata) {
        clearComposerReviewSelectionIfNeededForNonReviewContent()

        let normalizedSkillName = skill.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedSkillName.isEmpty else {
            resetSkillAutocompleteState()
            return
        }

        if let updatedInput = Self.replacingTrailingSkillAutocompleteToken(
            in: input, with: normalizedSkillName
        ) {
            input = updatedInput
        }

        let normalizedPath = skill.path?.trimmingCharacters(in: .whitespacesAndNewlines)
        if !composerMentionedSkills.contains(where: { $0.name.caseInsensitiveCompare(normalizedSkillName) == .orderedSame }) {
            composerMentionedSkills.append(
                TurnComposerMentionedSkill(
                    name: normalizedSkillName,
                    path: (normalizedPath?.isEmpty == false) ? normalizedPath : nil,
                    description: skill.description
                )
            )
        }

        resetSkillAutocompleteState()
    }

    // Keeps `/` command discovery separate from @/$ autocomplete while supporting a bare trailing slash.
    func onInputChangedForSlashCommandAutocomplete(
        _ text: String,
        activeTurnID: String?
    ) {
        clearComposerReviewSelectionIfNeededForInput(text)

        guard !isComposerInteractionLocked(activeTurnID: activeTurnID) else {
            resetSlashCommandState(clearPendingSelection: true)
            return
        }

        switch slashCommandPanelState {
        case .codeReviewTargets, .forkDestinations:
            return
        case .hidden, .commands:
            break
        }

        guard let token = Self.trailingSlashCommandToken(in: text) else {
            if case .commands = slashCommandPanelState {
                resetSlashCommandState()
            }
            return
        }

        resetFileAutocompleteState()
        resetSkillAutocompleteState()
        resetPluginAutocompleteState()
        slashCommandPanelState = .commands(query: token.query)
    }

    // Turns the selected slash command into the matching inline composer behavior.
    func onSelectSlashCommand(
        _ command: TurnComposerSlashCommand,
        availableForkDestinations: [TurnComposerForkDestination] = [.local]
    ) {
        switch command {
        case .codeReview:
            removeTrailingSlashCommandTokenFromInputIfNeeded()
            armCodeReviewSelection(command: command, target: nil)
        case .compact:
            removeTrailingSlashCommandTokenFromInputIfNeeded()
            resetSlashCommandState(clearPendingSelection: true)
        case .feedback:
            removeTrailingSlashCommandTokenFromInputIfNeeded()
            resetSlashCommandState(clearPendingSelection: true)
        case .fork:
            slashCommandPanelState = .forkDestinations(availableForkDestinations)
        case .status:
            removeTrailingSlashCommandTokenFromInputIfNeeded()
            resetSlashCommandState(clearPendingSelection: true)
        case .subagents:
            armSubagentsSelection()
        }
    }

    func onSelectCodeReviewTarget(_ target: TurnComposerReviewTarget) {
        removeTrailingSlashCommandTokenFromInputIfNeeded()
        armCodeReviewSelection(command: .codeReview, target: target)
    }

    // Keeps slash token cleanup and submenu dismissal consistent before a fork flow reroutes threads.
    func onSelectForkDestination(_ destination: TurnComposerForkDestination) {
        prepareForThreadRerouteFromSlashCommand()
    }

    func clearComposerReviewSelection() {
        composerReviewSelection = nil
        resetSlashCommandState()
    }

    func clearSubagentsSelection() {
        isSubagentsSelectionArmed = false
        resetSlashCommandState(clearPendingSelection: true)
    }

    func removeMentionedFile(id: String) {
        if let mention = composerMentionedFiles.first(where: { $0.id == id }) {
            let ambiguousKeys = Self.ambiguousFileNameAliasKeys(in: composerMentionedFiles)
            let collisionKey = Self.fileNameAliasCollisionKey(for: mention.fileName)
            let allowFileNameAliases = collisionKey.map { !ambiguousKeys.contains($0) } ?? true
            input = Self.removingFileMentionAliases(
                for: mention,
                from: input,
                allowFileNameAliases: allowFileNameAliases
            )
        }
        composerMentionedFiles.removeAll(where: { $0.id == id })
    }

    func removeMentionedSkill(id: String) {
        if let mention = composerMentionedSkills.first(where: { $0.id == id }) {
            input = Self.removeBoundedToken("$\(mention.name)", from: input)
        }
        composerMentionedSkills.removeAll(where: { $0.id == id })
    }

    func removeMentionedPlugin(id: String) {
        if let mention = composerMentionedPlugins.first(where: { $0.id == id }) {
            input = Self.removeBoundedToken("@\(mention.name)", from: input)
        }
        composerMentionedPlugins.removeAll(where: { $0.id == id })
    }

    func openCamera(constellagent: ConstellagentService) {
        guard remainingAttachmentSlots > 0 else {
            constellagent.lastErrorMessage = "You can attach up to \(maxComposerImages) images per message."
            return
        }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            constellagent.lastErrorMessage = "Camera is not available on this device."
            return
        }
        isCameraPresented = true
    }

    func enqueueCapturedImageData(_ data: Data, constellagent: ConstellagentService, threadID: String) {
        enqueuePastedImageData([data], constellagent: constellagent, threadID: threadID)
    }

    func openPhotoLibraryPicker(constellagent: ConstellagentService) {
        guard remainingAttachmentSlots > 0 else {
            constellagent.lastErrorMessage = "You can attach up to \(maxComposerImages) images per message."
            return
        }

        isPhotoPickerPresented = true
    }

    // Converts the picker results into loading slots and async image pipeline jobs.
    func enqueuePhotoPickerItems(_ items: [PhotosPickerItem], constellagent: ConstellagentService, threadID: String) {
        guard !items.isEmpty else {
            return
        }

        let intakePlan = TurnComposerAttachmentIntakePlan.make(
            requestedCount: items.count,
            remainingSlots: remainingAttachmentSlots
        )

        guard intakePlan.acceptedCount > 0 else {
            constellagent.lastErrorMessage = "You can attach up to \(maxComposerImages) images per message."
            return
        }

        let acceptedItems = Array(items.prefix(intakePlan.acceptedCount))
        if intakePlan.hasOverflow {
            constellagent.lastErrorMessage = "Only \(maxComposerImages) images are allowed per message."
        }

        clearComposerReviewSelectionIfNeededForNonReviewContent()

        for item in acceptedItems {
            let attachmentID = UUID().uuidString
            composerAttachments.append(TurnComposerImageAttachment(id: attachmentID, state: .loading))

            Task {
                let state = await Self.loadComposerAttachmentState(from: item)
                await MainActor.run {
                    self.updateComposerAttachment(id: attachmentID, state: state, constellagent: constellagent, threadID: threadID)
                }
            }
        }
        saveLocalDraft(constellagent: constellagent, threadID: threadID)
    }

    // Reuses the picker intake pipeline so pasted images obey the same limits and processing.
    func enqueuePastedImageData(_ imageDataItems: [Data], constellagent: ConstellagentService, threadID: String) {
        guard !imageDataItems.isEmpty else {
            return
        }

        let intakePlan = TurnComposerAttachmentIntakePlan.make(
            requestedCount: imageDataItems.count,
            remainingSlots: remainingAttachmentSlots
        )

        guard intakePlan.acceptedCount > 0 else {
            constellagent.lastErrorMessage = "You can attach up to \(maxComposerImages) images per message."
            return
        }

        let acceptedItems = Array(imageDataItems.prefix(intakePlan.acceptedCount))
        if intakePlan.hasOverflow {
            constellagent.lastErrorMessage = "Only \(maxComposerImages) images are allowed per message."
        }

        clearComposerReviewSelectionIfNeededForNonReviewContent()

        for imageData in acceptedItems {
            let attachmentID = UUID().uuidString
            composerAttachments.append(TurnComposerImageAttachment(id: attachmentID, state: .loading))

            Task {
                let state = Self.loadComposerAttachmentState(fromData: imageData)
                await MainActor.run {
                    self.updateComposerAttachment(id: attachmentID, state: state, constellagent: constellagent, threadID: threadID)
                }
            }
        }
        saveLocalDraft(constellagent: constellagent, threadID: threadID)
    }

    private func updateComposerAttachment(
        id: String,
        state: TurnComposerImageAttachmentState,
        constellagent: ConstellagentService,
        threadID: String
    ) {
        guard let index = composerAttachments.firstIndex(where: { $0.id == id }) else {
            return
        }

        composerAttachments[index].state = state
        saveLocalDraft(constellagent: constellagent, threadID: threadID, persistToDisk: true)
    }

    // Sends a composer payload, queueing follow-ups while the current run is still active.
    func sendTurn(
        constellagent: ConstellagentService,
        subscriptions: SubscriptionService? = nil,
        threadID: String
    ) {
        guard let pendingSend = buildValidatedPendingSend(
            constellagent: constellagent,
            subscriptions: subscriptions
        ) else {
            return
        }

        let queuedDraft = pendingSend.rawReviewSelection == nil
            ? makeQueuedDraft(from: pendingSend)
            : nil
        let threadBusy = isThreadBusy(constellagent: constellagent, threadID: threadID)
        let queuePaused = isQueuePaused(constellagent: constellagent, threadID: threadID)

        subscriptions?.consumeFreeSendAttemptIfNeeded()
        isSending = true
        isPlanModeArmed = false
        shouldAnchorToAssistantResponse = true
        clearComposer()

        Task { @MainActor in
            defer { isSending = false }

            let stillBusy = await refreshBusyStateIfNeeded(constellagent: constellagent, threadID: threadID, wasBusy: threadBusy)
            if stillBusy {
                await performBusyThreadSend(
                    pendingSend,
                    queuedDraft: queuedDraft,
                    constellagent: constellagent,
                    threadID: threadID
                )
                return
            }

            if queuePaused, let queuedDraft {
                appendQueuedDraft(queuedDraft, constellagent: constellagent, threadID: threadID)
                clearLocalDraft(constellagent: constellagent, threadID: threadID, persistToDisk: true)

                resumeQueueAndFlushIfPossible(constellagent: constellagent, threadID: threadID)
                return
            }

            await performTurnSend(pendingSend, constellagent: constellagent, threadID: threadID)
        }
    }

    // Starts a real thread only when the first draft message is sent from the New Chat screen.
    @discardableResult
    func sendNewThread(
        constellagent: ConstellagentService,
        subscriptions: SubscriptionService? = nil,
        draftThreadID: String,
        preferredProjectPath: String?,
        onThreadCreated: @escaping @MainActor @Sendable (ConstellagentThread) -> Void,
        onSendFailed: (@MainActor @Sendable () -> Void)? = nil
    ) -> Bool {
        guard let pendingSend = buildValidatedPendingSend(
            constellagent: constellagent,
            subscriptions: subscriptions
        ) else {
            return false
        }

        subscriptions?.consumeFreeSendAttemptIfNeeded()
        isSending = true
        isPlanModeArmed = false
        shouldAnchorToAssistantResponse = true
        let draftPreAppendedMessage = preAppendNewThreadUserMessageIfNeeded(
            pendingSend,
            constellagent: constellagent,
            threadID: draftThreadID
        )
        clearComposer()

        // Forwards the raw user input as the rootless chat slug hint so the
        // bridge can mirror Constellagent Desktop's `~/Documents/Constellagent/<DATE>/<slug>`
        // naming for projectless chats opened from the iOS draft composer.
        let rootlessChatPromptHint = pendingSend.rawInput

        Task { @MainActor in
            defer { isSending = false }

            do {
                let thread = try await constellagent.startThreadIfReady(
                    preferredProjectPath: preferredProjectPath,
                    rootlessChatPromptHint: rootlessChatPromptHint
                )
                let preAppendedMessage = movePreAppendedNewThreadUserMessageIfNeeded(
                    draftPreAppendedMessage,
                    pendingSend: pendingSend,
                    constellagent: constellagent,
                    draftThreadID: draftThreadID,
                    threadID: thread.id
                )
                onThreadCreated(thread)

                do {
                    try await dispatchPendingSend(
                        pendingSend,
                        constellagent: constellagent,
                        threadID: thread.id,
                        preAppendedMessage: preAppendedMessage
                    )
                    clearLocalDraft(constellagent: constellagent, threadID: draftThreadID, persistToDisk: true)
                    clearLocalDraft(constellagent: constellagent, threadID: thread.id, persistToDisk: true)
                } catch {
                    // The real thread is already visible; startTurn owns the failed row/footer state.
                    constellagent.lastErrorMessage = constellagent.userFacingTurnErrorMessageForFooter(from: error)
                }
            } catch {
                discardPreAppendedNewThreadUserMessage(
                    draftPreAppendedMessage,
                    constellagent: constellagent,
                    draftThreadID: draftThreadID
                )
                restorePendingSendOnFailure(
                    pendingSend,
                    error: error,
                    constellagent: constellagent,
                    draftThreadID: draftThreadID
                )
                onSendFailed?()
            }
        }
        return true
    }

    // Shared validation + payload assembly used by `sendTurn` and `sendNewThread`
    // so the empty/connected/blocking/review/subscription guards stay in one place.
    private func buildValidatedPendingSend(
        constellagent: ConstellagentService,
        subscriptions: SubscriptionService?
    ) -> PendingTurnSend? {
        let payload = buildPayloadWithMentions()
        let attachments = readyComposerAttachments
        let skillMentions = composerMentionedSkills.map {
            ConstellagentTurnSkillMention(id: $0.name, name: $0.name, path: $0.path)
        }
        let mentionMentions = composerMentionedPlugins.map {
            ConstellagentTurnMention(name: $0.name, path: $0.path)
        }
        let reviewSelection = composerReviewSelection

        guard (!payload.isEmpty || !attachments.isEmpty || reviewSelection != nil || !skillMentions.isEmpty || !mentionMentions.isEmpty),
              !isSending,
              constellagent.isConnected,
              !hasBlockingAttachmentState else {
            return nil
        }

        if reviewSelection != nil, hasComposerContentConflictingWithReview {
            constellagent.lastErrorMessage = "Clear text, files, skills, and images before starting a code review."
            return nil
        }

        if let subscriptions, !subscriptions.hasAppAccess {
            constellagent.lastErrorMessage = "Your 5 free messages are over. Unlock Constellagent Pro to keep chatting."
            return nil
        }

        return PendingTurnSend(
            payload: payload,
            attachments: attachments,
            skillMentions: skillMentions,
            mentionMentions: mentionMentions,
            collaborationMode: isPlanModeArmed ? .plan : nil,
            rawInput: input,
            rawFileMentions: composerMentionedFiles,
            rawSkillMentions: composerMentionedSkills,
            rawPluginMentions: composerMentionedPlugins,
            rawAttachments: composerAttachments,
            rawReviewSelection: reviewSelection,
            rawSubagentsSelectionArmed: isSubagentsSelectionArmed
        )
    }

    // Mirrors a validated PendingTurnSend into the queued-draft shape used when
    // sendTurn needs to defer the payload behind a busy thread or paused queue.
    private func makeQueuedDraft(from pendingSend: PendingTurnSend) -> QueuedTurnDraft {
        QueuedTurnDraft(
            id: UUID().uuidString,
            text: pendingSend.payload,
            attachments: pendingSend.attachments,
            skillMentions: pendingSend.skillMentions,
            mentionMentions: pendingSend.mentionMentions,
            collaborationMode: pendingSend.collaborationMode,
            rawInput: pendingSend.rawInput,
            rawFileMentions: pendingSend.rawFileMentions,
            rawSkillMentions: pendingSend.rawSkillMentions,
            rawPluginMentions: pendingSend.rawPluginMentions,
            rawAttachments: pendingSend.rawAttachments,
            rawSubagentsSelectionArmed: pendingSend.rawSubagentsSelectionArmed,
            createdAt: Date()
        )
    }

    // Moves the immediate draft bubble onto the real thread; falls back to appending
    // there if the draft row was pruned before thread/start returned.
    private func movePreAppendedNewThreadUserMessageIfNeeded(
        _ draftPreAppendedMessage: ConstellagentPreAppendedTurnMessage?,
        pendingSend: PendingTurnSend,
        constellagent: ConstellagentService,
        draftThreadID: String,
        threadID: String
    ) -> ConstellagentPreAppendedTurnMessage? {
        if let movedMessage = constellagent.movePreAppendedOutgoingUserMessage(
            draftPreAppendedMessage,
            from: draftThreadID,
            to: threadID
        ) {
            return movedMessage
        }

        return preAppendNewThreadUserMessageIfNeeded(
            pendingSend,
            constellagent: constellagent,
            threadID: threadID
        )
    }

    // Cleans up the draft-only optimistic row if thread/start itself fails.
    private func discardPreAppendedNewThreadUserMessage(
        _ draftPreAppendedMessage: ConstellagentPreAppendedTurnMessage?,
        constellagent: ConstellagentService,
        draftThreadID: String
    ) {
        guard let draftPreAppendedMessage else { return }
        constellagent.removeUserMessage(
            threadId: draftThreadID,
            messageId: draftPreAppendedMessage.messageID
        )
    }

    // Pre-publishes the first New Chat user row before ContentView swaps in TurnView.
    // Reviews use their own runtime event stream, so only normal turns get a row here.
    private func preAppendNewThreadUserMessageIfNeeded(
        _ pendingSend: PendingTurnSend,
        constellagent: ConstellagentService,
        threadID: String
    ) -> ConstellagentPreAppendedTurnMessage? {
        guard pendingSend.rawReviewSelection == nil else {
            return nil
        }

        return constellagent.preAppendOutgoingUserMessage(
            userInput: pendingSend.payload,
            threadId: threadID,
            attachments: pendingSend.attachments,
            skillMentions: pendingSend.skillMentions,
            mentionMentions: pendingSend.mentionMentions,
            fileMentions: confirmedFileMentionPaths(from: pendingSend.rawFileMentions)
        )
    }

    // Routes a PendingTurnSend through the right runtime call (review vs turn)
    // so sendNewThread doesn't have to duplicate the review branch from
    // performTurnSend. Errors bubble to the caller for context-specific recovery.
    private func dispatchPendingSend(
        _ pendingSend: PendingTurnSend,
        constellagent: ConstellagentService,
        threadID: String,
        preAppendedMessage: ConstellagentPreAppendedTurnMessage? = nil
    ) async throws {
        if let reviewSelection = pendingSend.rawReviewSelection {
            try await constellagent.startReview(
                threadId: threadID,
                target: reviewSelection.target?.constellagentReviewTarget,
                baseBranch: reviewBaseBranchName(for: reviewSelection)
            )
        } else {
            try await constellagent.startTurn(
                userInput: pendingSend.payload,
                threadId: threadID,
                attachments: pendingSend.attachments,
                skillMentions: pendingSend.skillMentions,
                mentionMentions: pendingSend.mentionMentions,
                fileMentions: confirmedFileMentionPaths(from: pendingSend.rawFileMentions),
                shouldAppendUserMessage: preAppendedMessage == nil,
                preAppendedUserMessageID: preAppendedMessage?.messageID,
                automaticTitleSeedOverride: preAppendedMessage?.automaticTitleSeed,
                collaborationMode: pendingSend.collaborationMode
            )
        }
    }

    // Shared failure recovery for both performTurnSend and sendNewThread: restores
    // the exact composer payload so the user can retry without re-typing, persists
    // it under the right thread id, and rebuilds the footer error message.
    private func restorePendingSendOnFailure(
        _ pendingSend: PendingTurnSend,
        error: Error,
        constellagent: ConstellagentService,
        draftThreadID: String
    ) {
        shouldAnchorToAssistantResponse = false
        restoreComposerState(from: pendingSend)
        saveLocalDraft(constellagent: constellagent, threadID: draftThreadID, persistToDisk: true)
        if pendingSend.collaborationMode == .plan,
           shouldRearmPlanModeAfterSendFailure(error) {
            isPlanModeArmed = true
        }
        let fallbackMessage = constellagent.userFacingTurnErrorMessageForFooter(from: error)
        if (constellagent.lastErrorMessage?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            && !(fallbackMessage?.isEmpty ?? true) {
            constellagent.lastErrorMessage = fallbackMessage
        }
    }

    func flushQueueIfPossible(constellagent: ConstellagentService, threadID: String) {
        guard !queuedDrafts(constellagent: constellagent, threadID: threadID).isEmpty,
              !isSending,
              steeringDraftID == nil,
              constellagent.isConnected,
              !isQueuePaused(constellagent: constellagent, threadID: threadID),
              !isThreadBusy(constellagent: constellagent, threadID: threadID) else {
            return
        }

        guard let nextDraft = dequeueQueuedDraft(constellagent: constellagent, threadID: threadID) else {
            return
        }
        isSending = true
        shouldAnchorToAssistantResponse = true

        Task { @MainActor in
            defer { isSending = false }

            do {
                try await constellagent.startTurn(
                    userInput: nextDraft.text,
                    threadId: threadID,
                    attachments: nextDraft.attachments,
                    skillMentions: nextDraft.skillMentions,
                    mentionMentions: nextDraft.mentionMentions,
                    fileMentions: confirmedFileMentionPaths(from: nextDraft.rawFileMentions),
                    collaborationMode: nextDraft.collaborationMode
                )
                constellagent.lastErrorMessage = nil
            } catch {
                shouldAnchorToAssistantResponse = false
                prependQueuedDraft(nextDraft, constellagent: constellagent, threadID: threadID)
                let queueErrorMessage = constellagent.userFacingTurnErrorMessage(from: error)
                setQueuePauseState(.paused(errorMessage: queueErrorMessage), constellagent: constellagent, threadID: threadID)
                if let footerMessage = constellagent.userFacingTurnErrorMessageForFooter(from: error) {
                    constellagent.lastErrorMessage = "Queue paused: \(footerMessage)"
                } else {
                    constellagent.lastErrorMessage = nil
                }
            }
        }
    }

    private func shouldRearmPlanModeAfterSendFailure(_ error: Error) -> Bool {
        guard let serviceError = error as? ConstellagentServiceError else {
            return false
        }

        guard case .invalidResponse(let reason) = serviceError else {
            return false
        }

        return reason.localizedCaseInsensitiveContains("plan mode requires an available model")
    }

    // Sends one queued draft into the active turn without disturbing the rest of the queue.
    func steerQueuedDraft(id: String, constellagent: ConstellagentService, threadID: String) {
        guard constellagent.isConnected,
              steeringDraftID == nil,
              isThreadBusy(constellagent: constellagent, threadID: threadID),
              let draft = queuedDrafts(constellagent: constellagent, threadID: threadID).first(where: { $0.id == id }) else {
            return
        }

        steeringDraftID = id
        shouldAnchorToAssistantResponse = true

        Task { @MainActor in
            defer { steeringDraftID = nil }

            do {
                let stillBusy = await refreshBusyStateIfNeeded(constellagent: constellagent, threadID: threadID, wasBusy: true)
                if !stillBusy {
                    try await constellagent.startTurn(
                        userInput: draft.text,
                        threadId: threadID,
                        attachments: draft.attachments,
                        skillMentions: draft.skillMentions,
                        mentionMentions: draft.mentionMentions,
                        fileMentions: confirmedFileMentionPaths(from: draft.rawFileMentions),
                        collaborationMode: draft.collaborationMode
                    )
                    removeQueuedDraft(id: id, constellagent: constellagent, threadID: threadID)
                    return
                }

                let expectedTurnID = try await resolveSteerExpectedTurnID(
                    constellagent: constellagent,
                    threadID: threadID
                )
                try await constellagent.steerTurn(
                    userInput: draft.text,
                    threadId: threadID,
                    expectedTurnId: expectedTurnID,
                    attachments: draft.attachments,
                    skillMentions: draft.skillMentions,
                    mentionMentions: draft.mentionMentions,
                    fileMentions: confirmedFileMentionPaths(from: draft.rawFileMentions),
                    shouldAppendUserMessage: true,
                    collaborationMode: draft.collaborationMode
                )
                removeQueuedDraft(id: id, constellagent: constellagent, threadID: threadID)
            } catch {
                shouldAnchorToAssistantResponse = false
                constellagent.removeLatestFailedUserMessage(
                    threadId: threadID,
                    matchingText: draft.text,
                    matchingAttachments: draft.attachments
                )
                constellagent.lastErrorMessage = constellagent.userFacingTurnErrorMessageForFooter(from: error)
            }
        }
    }

    func resumeQueueAndFlushIfPossible(constellagent: ConstellagentService, threadID: String) {
        setQueuePauseState(.active, constellagent: constellagent, threadID: threadID)
        if constellagent.lastErrorMessage?.hasPrefix("Queue paused:") == true {
            constellagent.lastErrorMessage = nil
        }
        flushQueueIfPossible(constellagent: constellagent, threadID: threadID)
    }

    func interruptTurn(_ turnID: String?, constellagent: ConstellagentService, threadID: String) {
        Task { @MainActor in
            do {
                try await constellagent.interruptTurn(turnId: turnID, threadId: threadID)
            } catch {
                // Error message already stored in ConstellagentService.
            }
        }
    }

    func dismissStructuredPlanPrompt(_ message: ConstellagentMessage, constellagent: ConstellagentService, threadID: String) {
        guard let request = message.structuredUserInputRequest else {
            return
        }

        let requestKey = constellagent.idKey(from: request.requestID)
        guard !dismissedStructuredPlanPromptRequestKeys.contains(requestKey) else {
            return
        }
        guard dismissingStructuredPlanPromptRequestKeys.insert(requestKey).inserted else {
            return
        }

        isPlanModeArmed = false
        clearComposerAutocomplete()

        Task { @MainActor in
            defer {
                dismissingStructuredPlanPromptRequestKeys.remove(requestKey)
            }

            do {
                try await constellagent.cancelStructuredPlanSession(
                    requestID: request.requestID,
                    turnId: message.turnId,
                    threadId: threadID
                )
                dismissedStructuredPlanPromptRequestKeys.insert(requestKey)
            } catch {
                constellagent.lastErrorMessage = constellagent.userFacingTurnErrorMessage(from: error)
            }
        }
    }

    func isStructuredPlanPromptDismissed(_ requestID: JSONValue, constellagent: ConstellagentService) -> Bool {
        dismissedStructuredPlanPromptRequestKeys.contains(constellagent.idKey(from: requestID))
    }

    func isStructuredPlanPromptDismissing(_ requestID: JSONValue, constellagent: ConstellagentService) -> Bool {
        dismissingStructuredPlanPromptRequestKeys.contains(constellagent.idKey(from: requestID))
    }

    func reconcileDismissedStructuredPlanPrompts(messages: [ConstellagentMessage], constellagent: ConstellagentService) {
        let activeRequestKeys: Set<String> = Set(messages.compactMap { message in
            guard message.kind == .userInputPrompt,
                  let request = message.structuredUserInputRequest else {
                return nil
            }
            return constellagent.idKey(from: request.requestID)
        })

        dismissedStructuredPlanPromptRequestKeys = dismissedStructuredPlanPromptRequestKeys.intersection(activeRequestKeys)
        dismissingStructuredPlanPromptRequestKeys = dismissingStructuredPlanPromptRequestKeys.intersection(activeRequestKeys)
    }

    func approve(
        _ request: ConstellagentApprovalRequest,
        constellagent: ConstellagentService,
        completion: @escaping @MainActor (Bool) -> Void
    ) {
        Task { @MainActor in
            isHandlingApproval = true
            defer { isHandlingApproval = false }

            do {
                try await constellagent.approvePendingRequest(request)
                completion(true)
            } catch {
                // Error message already stored in ConstellagentService.
                if let serviceError = error as? ConstellagentServiceError,
                   case .noPendingApproval = serviceError {
                    completion(true)
                } else {
                    completion(false)
                }
            }
        }
    }

    func decline(
        _ request: ConstellagentApprovalRequest,
        constellagent: ConstellagentService,
        completion: @escaping @MainActor (Bool) -> Void
    ) {
        Task { @MainActor in
            isHandlingApproval = true
            defer { isHandlingApproval = false }

            do {
                try await constellagent.declinePendingRequest(request)
                completion(true)
            } catch {
                // Error message already stored in ConstellagentService.
                if let serviceError = error as? ConstellagentServiceError,
                   case .noPendingApproval = serviceError {
                    completion(true)
                } else {
                    completion(false)
                }
            }
        }
    }

    private static func loadComposerAttachmentState(from item: PhotosPickerItem) async -> TurnComposerImageAttachmentState {
        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  !data.isEmpty else {
                return .failed
            }
            return loadComposerAttachmentState(fromData: data)
        } catch {
            return .failed
        }
    }

    private static func loadComposerAttachmentState(fromData data: Data) -> TurnComposerImageAttachmentState {
        guard let attachment = TurnAttachmentPipeline.makeAttachment(from: data) else {
            return .failed
        }
        return .ready(attachment)
    }

    // Extracts only a final `@query` token at the end of composer text.
    static func trailingFileAutocompleteToken(in text: String) -> TurnTrailingFileAutocompleteToken? {
        guard let token = trailingFileToken(in: text) else {
            return nil
        }

        return TurnTrailingFileAutocompleteToken(
            query: token.query,
            tokenRange: token.tokenRange
        )
    }

    // Extracts only a final `$query` token at the end of composer text.
    static func trailingSkillAutocompleteToken(in text: String) -> TurnTrailingSkillAutocompleteToken? {
        guard let token = trailingToken(in: text, trigger: "$", allowsEmptyQuery: true) else {
            return nil
        }

        // Reject pure-numeric queries like `$100`, `$42` — not skill names.
        guard token.query.isEmpty || token.query.contains(where: { $0.isLetter }) else {
            return nil
        }

        return TurnTrailingSkillAutocompleteToken(
            query: token.query,
            tokenRange: token.tokenRange
        )
    }

    // Plugin discovery opens on bare `@`; selecting a suggestion is what stores the structured mention.
    static func trailingPluginAutocompleteToken(in text: String) -> TurnTrailingPluginAutocompleteToken? {
        guard !text.isEmpty else {
            return nil
        }

        let tokenStart: String.Index
        if let lastWhitespaceIndex = text.lastIndex(where: { $0.isWhitespace }) {
            tokenStart = text.index(after: lastWhitespaceIndex)
        } else {
            tokenStart = text.startIndex
        }

        guard tokenStart < text.endIndex else {
            return nil
        }

        let token = text[tokenStart..<text.endIndex]
        guard token.first == "@" else {
            return nil
        }

        let lastAtIndex = token.lastIndex(of: "@") ?? token.startIndex
        let triggerIndex = lastAtIndex
        let mentionToken = text[triggerIndex..<text.endIndex]
        guard mentionToken.dropFirst().allSatisfy({ !$0.isWhitespace && $0 != "@" && $0 != "(" && $0 != ")" }) else {
            return nil
        }

        let queryStart = text.index(after: triggerIndex)
        let query = String(text[queryStart..<text.endIndex])
        guard !query.contains(where: { $0.isWhitespace }) else {
            return nil
        }

        return TurnTrailingPluginAutocompleteToken(
            query: query,
            tokenRange: triggerIndex..<text.endIndex
        )
    }

    // Extracts only a final `/query` token so slash commands open from the same composer input.
    static func trailingSlashCommandToken(in text: String) -> TurnTrailingSlashCommandToken? {
        TurnComposerCommandLogic.trailingSlashCommandToken(in: text)
    }

    static func replacingTrailingSlashCommandToken(in text: String, with replacement: String) -> String? {
        TurnComposerCommandLogic.replacingTrailingSlashCommandToken(in: text, with: replacement)
    }

    static func replacingTrailingFileAutocompleteToken(in text: String, with selectedPath: String) -> String? {
        let trimmedPath = selectedPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty,
              let token = trailingFileAutocompleteToken(in: text) else {
            return nil
        }

        var updated = text
        updated.replaceSubrange(token.tokenRange, with: "@\(trimmedPath) ")
        return updated
    }

    // Resolves file mentions from either the exact path or normalized alias forms.
    static func replacingFileMentionAliases(
        in text: String,
        with mention: TurnComposerMentionedFile,
        allowFileNameAliases: Bool = true
    ) -> String {
        let replacement = "@\(mention.path)"
        let placeholder = "__constellagent_file_mention__\(mention.path.hashValue)__"
        let replacedText = fileMentionAliases(
            fileName: mention.fileName,
            path: mention.path,
            allowFileNameAliases: allowFileNameAliases
        )
            .reduce(text) { partialText, alias in
                // Replace into a placeholder first so shorter aliases cannot re-match inside the canonical path.
                replaceBoundedToken(
                    "@\(alias)",
                    with: placeholder,
                    in: partialText,
                    caseInsensitive: true
                )
            }
        return replacedText.replacingOccurrences(of: placeholder, with: replacement)
    }

    // Removes any alias form for a selected file mention so chip deletion stays in sync with text.
    static func removingFileMentionAliases(
        for mention: TurnComposerMentionedFile,
        from text: String,
        allowFileNameAliases: Bool = true
    ) -> String {
        fileMentionAliases(
            fileName: mention.fileName,
            path: mention.path,
            allowFileNameAliases: allowFileNameAliases
        )
            .reduce(text) { partialText, alias in
                removeBoundedToken(
                    "@\(alias)",
                    from: partialText,
                    caseInsensitive: true
                )
            }
    }

    // Generates raw and normalized aliases so matching survives spaces, separators, and casing changes.
    static func fileMentionAliases(
        fileName: String,
        path: String,
        allowFileNameAliases: Bool = true
    ) -> [String] {
        var aliases: Set<String> = []
        var seeds = [path, deletingPathExtension(from: path)]

        if allowFileNameAliases {
            seeds.insert(fileName, at: 0)
            seeds.append(deletingPathExtension(from: fileName))
        }

        for seed in seeds {
            let trimmedSeed = seed.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedSeed.isEmpty else {
                continue
            }

            aliases.insert(trimmedSeed)
            appendNormalizedFileMentionAliases(for: trimmedSeed, into: &aliases)
        }

        return aliases
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .sorted {
                if $0.count == $1.count {
                    return $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
                }
                return $0.count > $1.count
            }
    }

    // When multiple mentions normalize to the same basename, only folder-aware aliases are safe.
    static func ambiguousFileNameAliasKeys(in mentions: [TurnComposerMentionedFile]) -> Set<String> {
        let groupedKeys = Dictionary(grouping: mentions.compactMap { mention in
            fileNameAliasCollisionKey(for: mention.fileName)
        }) { $0 }

        return Set(groupedKeys.compactMap { key, bucket in
            bucket.count > 1 ? key : nil
        })
    }

    // Detects when the last `@mention` already matches a confirmed chip and the user is now typing prose after it.
    static func hasClosedConfirmedFileMentionPrefix(
        in text: String,
        confirmedMentions: [TurnComposerMentionedFile]
    ) -> Bool {
        guard !confirmedMentions.isEmpty,
              let triggerIndex = text.lastIndex(of: "@") else {
            return false
        }

        if triggerIndex > text.startIndex {
            let previousCharacter = text[text.index(before: triggerIndex)]
            guard previousCharacter.isWhitespace else {
                return false
            }
        }

        let tail = String(text[text.index(after: triggerIndex)...])
        guard !tail.isEmpty else {
            return false
        }

        let ambiguousKeys = ambiguousFileNameAliasKeys(in: confirmedMentions)
        for mention in confirmedMentions {
            let collisionKey = fileNameAliasCollisionKey(for: mention.fileName)
            let allowFileNameAliases = collisionKey.map { !ambiguousKeys.contains($0) } ?? true
            let aliases = fileMentionAliases(
                fileName: mention.fileName,
                path: mention.path,
                allowFileNameAliases: allowFileNameAliases
            )

            for alias in aliases {
                guard let range = tail.range(
                    of: alias,
                    options: [.anchored, .caseInsensitive]
                ) else {
                    continue
                }

                guard range.upperBound < tail.endIndex,
                      tail[range.upperBound].isWhitespace else {
                    continue
                }

                return true
            }
        }

        return false
    }

    static func replacingTrailingSkillAutocompleteToken(in text: String, with selectedSkill: String) -> String? {
        let trimmedSkill = selectedSkill.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSkill.isEmpty,
              let token = trailingSkillAutocompleteToken(in: text) else {
            return nil
        }

        var updated = text
        updated.replaceSubrange(token.tokenRange, with: "$\(trimmedSkill) ")
        return updated
    }

    static func replacingTrailingPluginAutocompleteToken(in text: String, with selectedPlugin: String) -> String? {
        let trimmedPlugin = selectedPlugin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPlugin.isEmpty,
              let token = trailingPluginAutocompleteToken(in: text) else {
            return nil
        }

        var updated = text
        updated.replaceSubrange(token.tokenRange, with: "@\(trimmedPlugin) ")
        return updated
    }

    static func removingTrailingSlashCommandToken(in text: String) -> String? {
        TurnComposerCommandLogic.removingTrailingSlashCommandToken(in: text)
    }

    // Keeps file autocomplete scoped to the final adjacent `@token`; prose after a space closes it.
    private static func trailingFileToken(in text: String) -> TurnTrailingToken? {
        guard !text.isEmpty else {
            return nil
        }

        let tokenStart: String.Index
        if let lastWhitespaceIndex = text.lastIndex(where: { $0.isWhitespace }) {
            tokenStart = text.index(after: lastWhitespaceIndex)
        } else {
            tokenStart = text.startIndex
        }

        guard tokenStart < text.endIndex,
              text[tokenStart] == "@" else {
            return nil
        }

        if tokenStart > text.startIndex {
            let previousCharacter = text[text.index(before: tokenStart)]
            guard previousCharacter.isWhitespace else {
                return nil
            }
        }

        let queryStart = text.index(after: tokenStart)
        let query = String(text[queryStart..<text.endIndex])
        guard !query.isEmpty,
              !query.contains(where: { $0.isWhitespace || $0 == "@" }) else {
            return nil
        }

        let isBareLowercaseSearch = query.first?.isLowercase == true && !query.contains(":")
        guard isBareLowercaseSearch || isAllowedFileAutocompleteQuery(query) else {
            return nil
        }

        if let lastCharacter = query.last,
           ",.;:!?)]}".contains(lastCharacter),
           !TurnFileMentionHeuristics.isAllowedInlineMentionToken(query) {
            return nil
        }

        return TurnTrailingToken(query: query, tokenRange: tokenStart..<text.endIndex)
    }

    // Allows flexible file aliases while keeping common Swift attributes out of file search.
    private static func isAllowedFileAutocompleteQuery(_ query: String) -> Bool {
        TurnFileMentionHeuristics.isAllowedAutocompleteQuery(query)
    }

    // Shared parser for final-token autocomplete triggers (`@`, `$`).
    private static func trailingToken(
        in text: String,
        trigger: Character,
        allowsEmptyQuery: Bool = false
    ) -> TurnTrailingToken? {
        guard !text.isEmpty else {
            return nil
        }

        let tokenStart: String.Index
        if let lastWhitespaceIndex = text.lastIndex(where: { $0.isWhitespace }) {
            tokenStart = text.index(after: lastWhitespaceIndex)
        } else {
            tokenStart = text.startIndex
        }

        guard tokenStart < text.endIndex else {
            return nil
        }

        guard text[tokenStart] == trigger else {
            return nil
        }

        let queryStart = text.index(after: tokenStart)
        let query = String(text[queryStart..<text.endIndex])
        guard !query.contains(where: { $0.isWhitespace }),
              (allowsEmptyQuery || !query.isEmpty) else {
            return nil
        }

        return TurnTrailingToken(query: query, tokenRange: tokenStart..<text.endIndex)
    }

    private static func appendNormalizedFileMentionAliases(
        for seed: String,
        into aliases: inout Set<String>
    ) {
        let trimmedSeed = seed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSeed.isEmpty else {
            return
        }

        let pathExtension = (trimmedSeed as NSString).pathExtension
        let normalizedExtension = pathExtension.lowercased()
        let stem = normalizedExtension.isEmpty
            ? trimmedSeed
            : (trimmedSeed as NSString).deletingPathExtension
        let tokens = mentionSearchTokens(from: stem)
        guard !tokens.isEmpty else {
            return
        }

        var baseVariants: Set<String> = [
            tokens.joined(separator: " "),
            tokens.joined(separator: "-"),
            tokens.joined(separator: "_"),
            tokens.joined(),
            lowerCamelCase(from: tokens),
            upperCamelCase(from: tokens),
        ]
        baseVariants = baseVariants.filter { !$0.isEmpty }

        for variant in baseVariants {
            aliases.insert(variant)
            if !normalizedExtension.isEmpty {
                aliases.insert("\(variant).\(normalizedExtension)")
            }
        }
    }

    private static func mentionSearchTokens(from value: String) -> [String] {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedValue.isEmpty else {
            return []
        }

        return trimmedValue
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .flatMap(tokensFromMentionSegment)
    }

    // Keeps Apple-style prefixes like `iOS` together so alias variants stay natural.
    private static func tokensFromMentionSegment(_ segment: String) -> [String] {
        let trimmedSegment = segment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSegment.isEmpty else {
            return []
        }

        guard let regex = fileMentionSegmentRegex else {
            return [trimmedSegment.lowercased()]
        }

        let range = NSRange(trimmedSegment.startIndex..., in: trimmedSegment)
        let rawTokens = regex.matches(in: trimmedSegment, range: range).compactMap { match in
            Range(match.range, in: trimmedSegment).map { String(trimmedSegment[$0]) }
        }
        guard !rawTokens.isEmpty else {
            return [trimmedSegment.lowercased()]
        }

        var normalizedTokens: [String] = []
        var index = 0

        while index < rawTokens.count {
            let token = rawTokens[index]

            if token.count == 1,
               token == token.lowercased(),
               index + 1 < rawTokens.count,
               isAllCapsAcronym(rawTokens[index + 1]) {
                normalizedTokens.append((token + rawTokens[index + 1]).lowercased())
                index += 2
                continue
            }

            normalizedTokens.append(token.lowercased())
            index += 1
        }

        return normalizedTokens
    }

    private static func isAllCapsAcronym(_ token: String) -> Bool {
        token.count > 1
            && token.unicodeScalars.allSatisfy {
                CharacterSet.uppercaseLetters.contains($0) || CharacterSet.decimalDigits.contains($0)
            }
    }

    private static func lowerCamelCase(from tokens: [String]) -> String {
        guard let first = tokens.first else {
            return ""
        }

        let tail = tokens.dropFirst().map(capitalizedToken).joined()
        return first + tail
    }

    private static func upperCamelCase(from tokens: [String]) -> String {
        tokens.map(capitalizedToken).joined()
    }

    private static func capitalizedToken(_ token: String) -> String {
        guard let first = token.first else {
            return token
        }

        return first.uppercased() + token.dropFirst()
    }

    private static func deletingPathExtension(from value: String) -> String {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedValue.isEmpty else {
            return ""
        }
        return (trimmedValue as NSString).deletingPathExtension
    }

    private static func fileNameAliasCollisionKey(for fileName: String) -> String? {
        let trimmedName = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            return nil
        }

        let normalizedExtension = (trimmedName as NSString).pathExtension.lowercased()
        let stem = deletingPathExtension(from: trimmedName)
        let tokens = mentionSearchTokens(from: stem)
        guard !tokens.isEmpty else {
            return normalizedExtension.isEmpty ? nil : ".\(normalizedExtension)"
        }

        let tokenKey = tokens.joined(separator: "|")
        return normalizedExtension.isEmpty ? tokenKey : "\(tokenKey).\(normalizedExtension)"
    }

    private static func isMethodNotFoundRPCError(_ error: Error) -> Bool {
        let message = error.localizedDescription.lowercased()
        return message.contains("method not found")
            || message.contains("unsupported")
            || message.contains("code -32601")
    }

    // Filters pre-indexed skills using a single normalized search blob to reduce per-keystroke work.
    private func filteredSkillAutocompleteItems(
        for query: String,
        indexedSkills: [TurnSkillSearchIndexEntry]
    ) -> [ConstellagentSkillMetadata] {
        let needle = query.lowercased()
        let filtered = indexedSkills.lazy
            .filter { needle.isEmpty || $0.searchBlob.contains(needle) }
            .map(\.skill)
        return Array(filtered.prefix(maxSkillAutocompleteItems))
    }

    private func filteredPluginAutocompleteItems(
        for query: String,
        indexedPlugins: [TurnPluginSearchIndexEntry]
    ) -> [ConstellagentPluginMetadata] {
        let needle = ConstellagentPluginMetadata.normalizedDiscoveryText(query)
        let filtered = indexedPlugins.lazy
            .filter { needle.isEmpty || $0.searchBlob.contains(needle) }
            .map(\.plugin)
        return Array(filtered.prefix(maxPluginAutocompleteItems))
    }

    private func normalizedAutocompleteRoot(for thread: ConstellagentThread) -> String? {
        thread.gitWorkingDirectory
    }

    private func autocompleteCacheKey(forRoot root: String?) -> String {
        root ?? "__global__"
    }

    private func fileAutocompleteCancellationToken(for threadID: String) -> String {
        "ios-at-file-\(threadID)"
    }

    // Reuses the stop-button refresh path so queued sends do not trust stale running flags.
    private func refreshBusyStateIfNeeded(
        constellagent: ConstellagentService,
        threadID: String,
        wasBusy: Bool
    ) async -> Bool {
        guard wasBusy,
              constellagent.activeTurnID(for: threadID) == nil,
              (constellagent.runningThreadIDs.contains(threadID)
                || constellagent.protectedRunningFallbackThreadIDs.contains(threadID)) else {
            return wasBusy
        }

        _ = await constellagent.refreshInFlightTurnState(threadId: threadID)
        return isThreadBusy(constellagent: constellagent, threadID: threadID)
    }

    private func isThreadBusy(constellagent: ConstellagentService, threadID: String) -> Bool {
        constellagent.threadHasActiveOrRunningTurn(threadID)
    }

    // Queues normal follow-ups while a run is active; explicit steer stays behind the queued-draft action.
    private func performBusyThreadSend(
        _ pendingSend: PendingTurnSend,
        queuedDraft: QueuedTurnDraft?,
        constellagent: ConstellagentService,
        threadID: String
    ) async {
        if pendingSend.rawReviewSelection != nil {
            restoreComposerState(from: pendingSend)
            shouldAnchorToAssistantResponse = false
            constellagent.lastErrorMessage = "Wait for the current run to finish before starting a code review."
            return
        }

        guard let queuedDraft else {
            restoreComposerState(from: pendingSend)
            shouldAnchorToAssistantResponse = false
            return
        }

        isPlanModeArmed = false
        shouldAnchorToAssistantResponse = true
        appendQueuedDraft(queuedDraft, constellagent: constellagent, threadID: threadID)
        clearLocalDraft(constellagent: constellagent, threadID: threadID, persistToDisk: true)
    }

    // Sends the already-cleared composer payload and restores exact raw state if startTurn fails.
    private func performTurnSend(
        _ pendingSend: PendingTurnSend,
        constellagent: ConstellagentService,
        threadID: String
    ) async {
        do {
            try await dispatchPendingSend(pendingSend, constellagent: constellagent, threadID: threadID)
            clearLocalDraft(constellagent: constellagent, threadID: threadID, persistToDisk: true)
        } catch {
            restorePendingSendOnFailure(
                pendingSend,
                error: error,
                constellagent: constellagent,
                draftThreadID: threadID
            )
        }
    }

    // Restores the exact draft state after a failed send so slash/file/skill context survives retries.
    private func restoreComposerState(from pendingSend: PendingTurnSend) {
        input = pendingSend.rawInput
        composerMentionedFiles = pendingSend.rawFileMentions
        composerMentionedSkills = pendingSend.rawSkillMentions
        composerMentionedPlugins = pendingSend.rawPluginMentions
        composerAttachments = pendingSend.rawAttachments
        composerReviewSelection = pendingSend.rawReviewSelection
        isSubagentsSelectionArmed = pendingSend.rawSubagentsSelectionArmed
        isPlanModeArmed = pendingSend.collaborationMode == .plan
    }

    // Carries only autocomplete-confirmed file selections into the timeline renderer.
    private func confirmedFileMentionPaths(from mentions: [TurnComposerMentionedFile]) -> [String] {
        var uniquePaths: [String] = []
        var seenPaths: Set<String> = []

        for mention in mentions {
            let path = mention.path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !path.isEmpty, seenPaths.insert(path).inserted else {
                continue
            }
            uniquePaths.append(path)
        }

        return uniquePaths
    }

    // Restores a queued row using the exact composer payload captured before it entered the queue.
    private func restoreComposerState(from draft: QueuedTurnDraft) {
        input = draft.rawInput
        composerMentionedFiles = draft.rawFileMentions
        composerMentionedSkills = draft.rawSkillMentions
        composerMentionedPlugins = draft.rawPluginMentions
        composerAttachments = draft.rawAttachments
        composerReviewSelection = nil
        isSubagentsSelectionArmed = draft.rawSubagentsSelectionArmed
        isPlanModeArmed = draft.collaborationMode == .plan
    }

    // Restores a locally saved unsent draft when the user comes back to a chat.
    private func restoreComposerState(from draft: TurnComposerLocalDraft) {
        input = draft.input
        composerMentionedFiles = draft.mentionedFiles
        composerMentionedSkills = draft.mentionedSkills
        composerMentionedPlugins = draft.mentionedPlugins
        composerAttachments = draft.attachments
        composerReviewSelection = draft.reviewSelection
        isSubagentsSelectionArmed = draft.isSubagentsSelectionArmed
        isPlanModeArmed = draft.isPlanModeArmed
        clearComposerAutocomplete()
    }

    // Resolves the active turn id for manual steer without relying on async autoclosure operators.
    private func resolveSteerExpectedTurnID(
        constellagent: ConstellagentService,
        threadID: String
    ) async throws -> String? {
        if let activeTurnID = constellagent.activeTurnID(for: threadID) {
            return activeTurnID
        }

        return try await constellagent.resolveInFlightTurnID(threadId: threadID)
    }

    private func queuedDrafts(constellagent: ConstellagentService, threadID: String) -> [QueuedTurnDraft] {
        constellagent.queuedTurnDraftsByThread[threadID] ?? []
    }

    private func setQueuedDrafts(_ drafts: [QueuedTurnDraft], constellagent: ConstellagentService, threadID: String) {
        if drafts.isEmpty {
            constellagent.queuedTurnDraftsByThread.removeValue(forKey: threadID)
            return
        }
        constellagent.queuedTurnDraftsByThread[threadID] = drafts
    }

    private func appendQueuedDraft(_ draft: QueuedTurnDraft, constellagent: ConstellagentService, threadID: String) {
        var drafts = queuedDrafts(constellagent: constellagent, threadID: threadID)
        drafts.append(draft)
        setQueuedDrafts(drafts, constellagent: constellagent, threadID: threadID)
    }

    private func prependQueuedDraft(_ draft: QueuedTurnDraft, constellagent: ConstellagentService, threadID: String) {
        var drafts = queuedDrafts(constellagent: constellagent, threadID: threadID)
        drafts.insert(draft, at: 0)
        setQueuedDrafts(drafts, constellagent: constellagent, threadID: threadID)
    }

    private func dequeueQueuedDraft(constellagent: ConstellagentService, threadID: String) -> QueuedTurnDraft? {
        var drafts = queuedDrafts(constellagent: constellagent, threadID: threadID)
        guard !drafts.isEmpty else { return nil }
        let nextDraft = drafts.removeFirst()
        setQueuedDrafts(drafts, constellagent: constellagent, threadID: threadID)
        return nextDraft
    }

    private func queuePauseState(constellagent: ConstellagentService, threadID: String) -> QueuePauseState {
        constellagent.queuePauseStateByThread[threadID] ?? .active
    }

    private func setQueuePauseState(_ state: QueuePauseState, constellagent: ConstellagentService, threadID: String) {
        switch state {
        case .active:
            constellagent.queuePauseStateByThread.removeValue(forKey: threadID)
        case .paused:
            constellagent.queuePauseStateByThread[threadID] = state
        }
    }

    private func resetFileAutocompleteState() {
        fileAutocompleteDebounceTask?.cancel()
        fileAutocompleteDebounceTask = nil
        fileAutocompleteItems = []
        isFileAutocompleteVisible = false
        isFileAutocompleteLoading = false
        fileAutocompleteQuery = ""
    }

    private func resetSkillAutocompleteState() {
        skillAutocompleteDebounceTask?.cancel()
        skillAutocompleteDebounceTask = nil
        skillAutocompleteItems = []
        isSkillAutocompleteVisible = false
        isSkillAutocompleteLoading = false
        skillAutocompleteQuery = ""
    }

    private func resetPluginAutocompleteState() {
        pluginAutocompleteDebounceTask?.cancel()
        pluginAutocompleteDebounceTask = nil
        pluginAutocompleteItems = []
        isPluginAutocompleteVisible = false
        isPluginAutocompleteLoading = false
        pluginAutocompleteQuery = ""
    }

    private func resetSlashCommandState(
        clearPendingSelection: Bool = false,
        clearConfirmedSelection: Bool = false
    ) {
        slashCommandPanelState = .hidden
        if clearConfirmedSelection {
            composerReviewSelection = nil
            return
        }
        if clearPendingSelection, composerReviewSelection?.target == nil {
            composerReviewSelection = nil
        }
    }

    // Normalizes the composer when a slash action is accepted so the helper token does not leak into the draft.
    private func removeTrailingSlashCommandTokenFromInputIfNeeded() {
        if let updatedInput = Self.removingTrailingSlashCommandToken(in: input) {
            input = updatedInput
        }
    }

    // Arms the inline review flow while keeping its state transitions in one place.
    private func armCodeReviewSelection(
        command: TurnComposerSlashCommand,
        target: TurnComposerReviewTarget?
    ) {
        guard !hasComposerContentConflictingWithReview else {
            resetSlashCommandState(clearPendingSelection: true)
            return
        }

        composerReviewSelection = TurnComposerReviewSelection(command: command, target: target)
        slashCommandPanelState = (target == nil) ? .codeReviewTargets : .hidden
    }

    // Arms the composer-level subagents chip without leaking a slash token into the draft.
    private func armSubagentsSelection() {
        removeTrailingSlashCommandTokenFromInputIfNeeded()
        clearComposerReviewSelectionIfNeededForNonReviewContent()
        isSubagentsSelectionArmed = true
        resetSlashCommandState(clearPendingSelection: true)
    }

    private func clearComposerReviewSelectionIfNeededForInput(_ text: String) {
        guard composerReviewSelection?.target != nil else {
            return
        }

        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            clearComposerReviewSelection()
        }
    }

    private func clearComposerReviewSelectionIfNeededForNonReviewContent() {
        guard composerReviewSelection?.target != nil else {
            return
        }

        clearComposerReviewSelection()
    }

    private static func turnComposerReviewTarget(
        for target: ConstellagentPendingCodeReviewTarget
    ) -> TurnComposerReviewTarget {
        switch target {
        case .uncommittedChanges:
            return .uncommittedChanges
        case .baseBranch:
            return .baseBranch
        }
    }

    // Prefixes the composer draft with the canned delegation prompt when the chip is armed.
    static func applyingSubagentsSelection(to text: String, isSelected: Bool) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isSelected,
              let cannedPrompt = TurnComposerSlashCommand.subagents.cannedPrompt else {
            return trimmed
        }

        guard !trimmed.isEmpty else {
            return cannedPrompt
        }

        return "\(cannedPrompt)\n\n\(trimmed)"
    }

    // Replaces inline `@filename` with `@fullpath` for each mentioned file.
    private func buildPayloadWithMentions() -> String {
        var text = input

        if !composerMentionedFiles.isEmpty {
            let ambiguousKeys = Self.ambiguousFileNameAliasKeys(in: composerMentionedFiles)

            for mention in composerMentionedFiles {
                let collisionKey = Self.fileNameAliasCollisionKey(for: mention.fileName)
                let allowFileNameAliases = collisionKey.map { !ambiguousKeys.contains($0) } ?? true
                text = Self.replacingFileMentionAliases(
                    in: text,
                    with: mention,
                    allowFileNameAliases: allowFileNameAliases
                )
            }
        }

        return Self.applyingSubagentsSelection(
            to: text,
            isSelected: isSubagentsSelectionArmed
        )
    }

    // Reuses the git base-branch selector so review requests stay aligned with the visible compare target.
    private func reviewBaseBranchName(for selection: TurnComposerReviewSelection) -> String? {
        guard selection.target == .baseBranch else {
            return nil
        }
        return selectedGitBaseBranch.nilIfEmpty ?? localSelectableGitDefaultBranch
    }

    /// Removes the first occurrence of `token` that sits at a word boundary
    /// (followed by whitespace, punctuation, or end-of-string). Consumes one trailing space when present.
    static func removeBoundedToken(
        _ token: String,
        from text: String,
        caseInsensitive: Bool = false
    ) -> String {
        let escaped = NSRegularExpression.escapedPattern(for: token)
        let options: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
        guard let regex = try? NSRegularExpression(
            pattern: escaped + "(?:[\\s,.;:!?)\\]}>]|$)",
            options: options
        ) else {
            return text
        }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range) else {
            return text
        }
        var result = text
        let matchRange = Range(match.range, in: text)!
        result.replaceSubrange(matchRange, with: "")
        return result
    }

    /// Replaces all boundary-safe occurrences of `token` with `replacement`.
    /// Boundary = followed by whitespace, punctuation, or end-of-string.
    static func replaceBoundedToken(
        _ token: String,
        with replacement: String,
        in text: String,
        caseInsensitive: Bool = false
    ) -> String {
        let escaped = NSRegularExpression.escapedPattern(for: token)
        let options: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
        guard let regex = try? NSRegularExpression(
            pattern: escaped + "(?=[\\s,.;:!?)\\]}>]|$)",
            options: options
        ) else {
            return text
        }
        let range = NSRange(text.startIndex..., in: text)
        let safeReplacement = NSRegularExpression.escapedTemplate(for: replacement)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: safeReplacement)
    }

    // MARK: - Git Actions

    func triggerGitAction(
        _ action: TurnGitActionKind,
        constellagent: ConstellagentService,
        workingDirectory: String?,
        threadID: String,
        activeTurnID: String?
    ) {
        guard !isRunningGitAction else { return }
        runningGitAction = action
        beginGitActionProgress(action)

        Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                self.runningGitAction = nil
                self.gitActionProgress = nil
                self.inlineCommitAndPushPhase = nil
            }

            let gitService = GitActionsService(constellagent: constellagent, workingDirectory: workingDirectory)
            let gitWriterModel = constellagent.gitWriterModelIdentifier()

            do {
                switch action {
                case .initialize:
                    let result = try await gitService.initializeRepository()
                    if let status = result.status {
                        applyGitRepoSync(status)
                    }
                    let branchesResult = try? await gitService.branchesWithStatus()
                    if let branchesResult {
                        applyGitBranchTargets(branchesResult)
                    }

                case .syncNow:
                    let result = try await gitService.status()
                    applyGitRepoSync(result)
                    if result.state == "behind_only" {
                        let pullResult = try await gitService.pull()
                        if let status = pullResult.status {
                            applyGitRepoSync(status)
                        }
                    } else if result.state == "diverged" || result.state == "dirty_and_behind" {
                        gitSyncAlert = TurnGitSyncAlert(
                            title: result.state == "diverged" ? "Branch diverged from remote" : "Local changes need attention",
                            message: result.state == "diverged"
                                ? "Local and remote history both moved. Pull with rebase to reconcile them?"
                                : "You have local changes and the remote branch moved ahead. Pull with rebase only if you're ready to reconcile those changes.",
                            action: .pullRebase
                        )
                    }

                case .commit:
                    let result = try await runStackedGitAction(
                        .commit,
                        gitService: gitService,
                        model: gitWriterModel
                    )
                    if let status = result.status { applyGitRepoSync(status) }
                    presentGitActionSuccess(.init(
                        kind: .commit,
                        title: "Committed",
                        subtitle: result.status?.currentBranch
                    ))

                case .push:
                    let result = try await runStackedGitAction(
                        .push,
                        gitService: gitService,
                        model: gitWriterModel
                    )
                    handleSuccessfulStackedGitAction(
                        result,
                        constellagent: constellagent,
                        workingDirectory: workingDirectory,
                        threadID: threadID
                    )
                    presentGitActionSuccess(.init(
                        kind: .push,
                        title: "Pushed",
                        subtitle: result.status?.currentBranch
                    ))

                case .commitAndPush:
                    guard gitRepoSync?.hasPushRemote == true else {
                        throw GitActionsError.bridgeError(
                            code: "no_remote",
                            message: "Add a Git remote before using Commit & Push."
                        )
                    }
                    let result = try await runStackedGitAction(
                        .commitAndPush,
                        gitService: gitService,
                        model: gitWriterModel
                    )
                    handleSuccessfulStackedGitAction(result, constellagent: constellagent, workingDirectory: workingDirectory, threadID: threadID)
                    presentGitActionSuccess(.init(
                        kind: .push,
                        title: "Commit & push complete",
                        subtitle: result.status?.currentBranch
                    ))

                case .commitPushCreatePR:
                    let result = try await runStackedGitAction(
                        .commitPushCreatePR,
                        gitService: gitService,
                        model: gitWriterModel
                    )
                    handleSuccessfulStackedGitAction(result, constellagent: constellagent, workingDirectory: workingDirectory, threadID: threadID)
                    presentGitActionSuccess(.init(
                        kind: .pullRequest(url: result.pullRequest.url),
                        title: "Pull request opened",
                        subtitle: result.pullRequest.url
                    ))

                case .createPR:
                    if let validationMessage = createPullRequestValidationMessage {
                        throw GitActionsError.bridgeError(code: "pull_request_unavailable", message: validationMessage)
                    }
                    let result = try await runStackedGitAction(
                        .createPR,
                        gitService: gitService,
                        model: gitWriterModel
                    )
                    handleSuccessfulStackedGitAction(result, constellagent: constellagent, workingDirectory: workingDirectory, threadID: threadID)
                    presentGitActionSuccess(.init(
                        kind: .pullRequest(url: result.pullRequest.url),
                        title: "Pull request opened",
                        subtitle: result.pullRequest.url
                    ))

                case .discardRuntimeChangesAndSync:
                    let unpushedCommitWarning: String
                    if let repoSync = gitRepoSync, repoSync.aheadCount > 0 {
                        let commitLabel = repoSync.aheadCount == 1 ? "1 local commit" : "\(repoSync.aheadCount) local commits"
                        unpushedCommitWarning = " This also deletes \(commitLabel) that have not been pushed."
                    } else {
                        unpushedCommitWarning = ""
                    }
                    gitSyncAlert = TurnGitSyncAlert(
                        title: "Discard local changes?",
                        message: "This resets the current branch to match the remote and removes local uncommitted changes.\(unpushedCommitWarning) This cannot be undone from the app.",
                        buttons: [
                            TurnGitSyncAlertButton(title: "Cancel", role: .cancel, action: .dismissOnly),
                            TurnGitSyncAlertButton(title: "Discard Changes", role: .destructive, action: .discardRuntimeChanges)
                        ]
                    )
                }
            } catch let error as GitActionsError {
                switch error {
                case .bridgeError(let code, _) where code == "nothing_to_commit":
                    isShowingNothingToCommitAlert = true
                default:
                    gitSyncAlert = TurnGitSyncAlert(
                        title: "Git Error",
                        message: error.errorDescription ?? "Operation failed.",
                        action: .dismissOnly
                    )
                }
            } catch {
                gitSyncAlert = TurnGitSyncAlert(
                    title: "Git Error",
                    message: error.localizedDescription,
                    action: .dismissOnly
                )
            }
        }
    }

    func inlineCommitAndPush(constellagent: ConstellagentService, workingDirectory: String?, threadID: String) {
        guard !isRunningGitAction else { return }
        runningGitAction = .commitAndPush
        beginGitActionProgress(.commitAndPush)
        inlineCommitAndPushPhase = .committing

        Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                self.runningGitAction = nil
                self.gitActionProgress = nil
                self.inlineCommitAndPushPhase = nil
            }

            let gitService = GitActionsService(constellagent: constellagent, workingDirectory: workingDirectory)
            let gitWriterModel = constellagent.gitWriterModelIdentifier()
            do {
                let result = try await runStackedGitAction(
                    .commitAndPush,
                    gitService: gitService,
                    model: gitWriterModel
                )
                handleSuccessfulStackedGitAction(
                    result,
                    constellagent: constellagent,
                    workingDirectory: workingDirectory,
                    threadID: threadID
                )
                presentGitActionSuccess(.init(
                    kind: .push,
                    title: "Commit & push complete",
                    subtitle: result.status?.currentBranch
                ))
            } catch let error as GitActionsError {
                switch error {
                case .bridgeError(let code, _) where code == "nothing_to_commit":
                    isShowingNothingToCommitAlert = true
                default:
                    gitSyncAlert = TurnGitSyncAlert(
                        title: "Git Error",
                        message: error.errorDescription ?? "Operation failed.",
                        action: .dismissOnly
                    )
                }
            } catch {
                gitSyncAlert = TurnGitSyncAlert(
                    title: "Git Error",
                    message: error.localizedDescription,
                    action: .dismissOnly
                )
            }
        }
    }

    // Centralizes the mobile-to-bridge mapping for stacked Git publishing actions.
    // Drives `gitActionProgress` so the toast can reflect the live phase reported by the bridge.
    private func runStackedGitAction(
        _ action: TurnGitActionKind,
        gitService: GitActionsService,
        model: String?
    ) async throws -> GitStackedActionResult {
        guard let actionIdentifier = action.stackedActionIdentifier else {
            throw GitActionsError.bridgeError(code: "invalid_git_action", message: "Unsupported Git action.")
        }

        let baseBranch = gitDefaultBranch.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let latestRepoSync = (try? await gitService.status()) ?? gitRepoSync
        if let latestRepoSync {
            applyGitRepoSync(latestRepoSync)
        }
        let branch = (latestRepoSync?.currentBranch ?? currentGitBranch).trimmingCharacters(in: .whitespacesAndNewlines)
        let shouldCreateFeatureBranch = action == .commitPushCreatePR && (baseBranch.map { branch == $0 } ?? false)

        let hasWorkingTreeChanges = latestRepoSync?.isDirty ?? true
        let wantsCommitStep = action == .commit || ((action == .commitAndPush || action == .commitPushCreatePR) && hasWorkingTreeChanges)
        let needsCommitMessageGeneration = wantsCommitStep
        // Recompute the plan now that we know the feature-branch decision and commit-message intent.
        recomputeGitActionPlannedPhases(
            for: action,
            hasCustomCommitMessage: !needsCommitMessageGeneration,
            willCreateFeatureBranch: shouldCreateFeatureBranch,
            hasWorkingTreeChanges: hasWorkingTreeChanges
        )

        let commitMessage: String?
        if needsCommitMessageGeneration {
            advanceGitActionPhase(to: .generatingCommit)
            commitMessage = await generatedGitCommitMessageOrNil(gitService: gitService, model: model)
            completeGitActionPhase(.generatingCommit)
        } else {
            commitMessage = nil
        }

        return try await gitService.runStackedAction(
            action: actionIdentifier,
            commitMessage: commitMessage,
            model: model,
            baseBranch: baseBranch,
            featureBranch: shouldCreateFeatureBranch,
            onProgress: { [weak self] phase, status in
                self?.applyGitActionProgressEvent(phase: phase, status: status)
            }
        )
    }

    // MARK: Progress + success helpers

    private func beginGitActionProgress(_ action: TurnGitActionKind) {
        gitActionSuccessDismissTask?.cancel()
        gitActionSuccessDismissTask = nil
        gitActionSuccess = nil
        inlineCommitAndPushPhase = nil
        let phases = action.plannedPhases(
            repoSync: gitRepoSync,
            hasCustomCommitMessage: false,
            willCreateFeatureBranch: false,
            hasWorkingTreeChanges: gitRepoSync?.isDirty
        )
        gitActionProgress = TurnGitActionProgress(action: action, plannedPhases: phases)
    }

    private func recomputeGitActionPlannedPhases(
        for action: TurnGitActionKind,
        hasCustomCommitMessage: Bool,
        willCreateFeatureBranch: Bool,
        hasWorkingTreeChanges: Bool? = nil
    ) {
        guard var progress = gitActionProgress, progress.action == action else { return }
        let phases = action.plannedPhases(
            repoSync: gitRepoSync,
            hasCustomCommitMessage: hasCustomCommitMessage,
            willCreateFeatureBranch: willCreateFeatureBranch,
            hasWorkingTreeChanges: hasWorkingTreeChanges
        )
        progress = TurnGitActionProgress(
            action: action,
            plannedPhases: phases,
            currentPhase: progress.currentPhase,
            completedPhases: progress.completedPhases.intersection(phases),
            skippedPhases: progress.skippedPhases.intersection(phases)
        )
        gitActionProgress = progress
    }

    private func advanceGitActionPhase(to phase: TurnGitActionPhase) {
        guard var progress = gitActionProgress else { return }
        progress.currentPhase = phase
        gitActionProgress = progress
    }

    private func completeGitActionPhase(_ phase: TurnGitActionPhase) {
        guard var progress = gitActionProgress else { return }
        progress.completedPhases.insert(phase)
        if progress.currentPhase == phase {
            progress.currentPhase = nil
        }
        gitActionProgress = progress
    }

    private func applyGitActionProgressEvent(
        phase: TurnGitActionPhase,
        status: TurnGitActionPhaseStatus
    ) {
        guard var progress = gitActionProgress else { return }
        switch status {
        case .started:
            progress.currentPhase = phase
            // Mirror the bridge's commit phase to the inline button title.
            if phase == .commit {
                inlineCommitAndPushPhase = .committing
            } else if phase == .push {
                inlineCommitAndPushPhase = .pushing
            }
        case .completed:
            progress.completedPhases.insert(phase)
            progress.skippedPhases.remove(phase)
            if progress.currentPhase == phase {
                progress.currentPhase = nil
            }
        case .skipped:
            progress.skippedPhases.insert(phase)
            if progress.currentPhase == phase {
                progress.currentPhase = nil
            }
        }
        gitActionProgress = progress
    }

    private func presentGitActionSuccess(_ success: TurnGitActionSuccess) {
        gitActionSuccess = success
        gitActionSuccessDismissTask?.cancel()
        gitActionSuccessDismissTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard !Task.isCancelled else { return }
            guard let self, self.gitActionSuccess?.id == success.id else { return }
            self.gitActionSuccess = nil
        }
    }

    func dismissGitActionSuccess() {
        gitActionSuccessDismissTask?.cancel()
        gitActionSuccessDismissTask = nil
        gitActionSuccess = nil
    }

    // AI writing is a polish layer; Git actions must still work when the writer is unavailable.
    private func generatedGitCommitMessageOrNil(
        gitService: GitActionsService,
        model: String?
    ) async -> String? {
        do {
            return try await gitService.generateCommitMessage(model: model).fullMessage
        } catch {
            return nil
        }
    }

}

struct TurnComposerMentionedFile: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let fileName: String
    let path: String

    init(id: String = UUID().uuidString, fileName: String, path: String) {
        self.id = id
        self.fileName = fileName
        self.path = path
    }
}

struct TurnComposerMentionedSkill: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let name: String
    let path: String?
    let description: String?

    init(id: String = UUID().uuidString, name: String, path: String?, description: String?) {
        self.id = id
        self.name = name
        self.path = path
        self.description = description
    }
}

struct TurnComposerMentionedPlugin: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let name: String
    let path: String
    let displayName: String?

    init(id: String = UUID().uuidString, name: String, path: String, displayName: String?) {
        self.id = id
        self.name = name
        self.path = path
        self.displayName = displayName
    }
}

struct TurnTrailingFileAutocompleteToken: Equatable {
    let query: String
    let tokenRange: Range<String.Index>
}

struct TurnTrailingSkillAutocompleteToken: Equatable {
    let query: String
    let tokenRange: Range<String.Index>
}

struct TurnTrailingPluginAutocompleteToken: Equatable {
    let query: String
    let tokenRange: Range<String.Index>
}

private struct TurnTrailingToken: Equatable {
    let query: String
    let tokenRange: Range<String.Index>
}

private struct TurnSkillSearchIndexEntry: Equatable {
    let skill: ConstellagentSkillMetadata
    let searchBlob: String

    init(skill: ConstellagentSkillMetadata) {
        self.skill = skill
        let name = skill.name.lowercased()
        let displayName = SkillDisplayNameFormatter.displayName(for: skill.name).lowercased()
        let description = skill.description?.lowercased() ?? ""
        if description.isEmpty {
            self.searchBlob = "\(name)\n\(displayName)"
        } else {
            self.searchBlob = "\(name)\n\(displayName)\n\(description)"
        }
    }
}

private struct TurnPluginSearchIndexEntry: Equatable {
    let plugin: ConstellagentPluginMetadata
    let searchBlob: String

    init(plugin: ConstellagentPluginMetadata) {
        self.plugin = plugin
        self.searchBlob = plugin.searchBlob
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
