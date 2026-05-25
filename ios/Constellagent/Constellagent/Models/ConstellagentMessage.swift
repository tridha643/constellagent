// FILE: ConstellagentMessage.swift
// Purpose: Defines chat messages rendered in each thread conversation timeline.
// Layer: Model
// Exports: ConstellagentMessage, ConstellagentMessageRole
// Depends on: Foundation

import Foundation

enum ConstellagentMessageRole: String, Codable, Hashable, Sendable {
    case user
    case assistant
    case system
}

enum ConstellagentMessageDeliveryState: String, Codable, Hashable, Sendable {
    case pending
    case confirmed
    case failed
}

enum ConstellagentMessageKind: String, Codable, Hashable, Sendable {
    case chat
    case thinking
    case toolActivity
    case fileChange
    case commandExecution
    case subagentAction
    case plan
    case userInputPrompt
}

struct ConstellagentMessageTextRenderSignature: Codable, Hashable, Sendable {
    let byteCount: Int
    let revision: Int

    init(text: String) {
        self.byteCount = text.utf8.count
        self.revision = ConstellagentMessageTextRenderSignatureCounter.next()
    }
}

/// Gives message text changes a tiny render-facing identity so SwiftUI equality
/// can avoid rescanning large transcripts while rows are diffed.
nonisolated enum ConstellagentMessageTextRenderSignatureCounter {
    private nonisolated(unsafe) static var counter: Int = 0
    private static let lock = NSLock()

    static func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        let value = counter
        counter += 1
        return value
    }
}

struct ConstellagentMessage: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let threadId: String
    let role: ConstellagentMessageRole
    var kind: ConstellagentMessageKind
    var assistantPhase: String?
    var text: String {
        didSet {
            textRenderSignature = ConstellagentMessageTextRenderSignature(text: text)
        }
    }
    var textRenderSignature: ConstellagentMessageTextRenderSignature
    var fileMentions: [String]
    var skillMentions: [String]
    var pluginMentions: [String]
    var createdAt: Date
    var turnId: String?
    var itemId: String?
    var isStreaming: Bool
    var deliveryState: ConstellagentMessageDeliveryState
    var attachments: [ConstellagentImageAttachment]
    var planState: ConstellagentPlanState?
    var planPresentation: ConstellagentPlanPresentation?
    var proposedPlan: ConstellagentProposedPlan?
    var subagentAction: ConstellagentSubagentAction?
    var structuredUserInputRequest: ConstellagentStructuredUserInputRequest?

    /// Monotonically increasing counter that preserves insertion order.
    /// Used as primary sort key so messages are never reordered by timestamp drift.
    var orderIndex: Int

    init(
        id: String = UUID().uuidString,
        threadId: String,
        role: ConstellagentMessageRole,
        kind: ConstellagentMessageKind = .chat,
        assistantPhase: String? = nil,
        text: String,
        fileMentions: [String] = [],
        skillMentions: [String] = [],
        pluginMentions: [String] = [],
        createdAt: Date = Date(),
        turnId: String? = nil,
        itemId: String? = nil,
        isStreaming: Bool = false,
        deliveryState: ConstellagentMessageDeliveryState = .confirmed,
        attachments: [ConstellagentImageAttachment] = [],
        planState: ConstellagentPlanState? = nil,
        planPresentation: ConstellagentPlanPresentation? = nil,
        proposedPlan: ConstellagentProposedPlan? = nil,
        subagentAction: ConstellagentSubagentAction? = nil,
        structuredUserInputRequest: ConstellagentStructuredUserInputRequest? = nil,
        orderIndex: Int? = nil
    ) {
        self.id = id
        self.threadId = threadId
        self.role = role
        self.kind = kind
        self.assistantPhase = assistantPhase
        self.text = text
        self.textRenderSignature = ConstellagentMessageTextRenderSignature(text: text)
        self.fileMentions = fileMentions
        self.skillMentions = skillMentions
        self.pluginMentions = pluginMentions
        self.createdAt = createdAt
        self.turnId = turnId
        self.itemId = itemId
        self.isStreaming = isStreaming
        self.deliveryState = deliveryState
        self.attachments = attachments
        self.planState = planState
        self.planPresentation = Self.derivedPlanPresentation(
            role: role,
            kind: kind,
            planState: planState,
            planPresentation: planPresentation,
            itemId: itemId,
            proposedPlan: proposedPlan
        )
        self.proposedPlan = proposedPlan ?? Self.derivedProposedPlan(
            role: role,
            kind: kind,
            text: text,
            itemId: itemId,
            planState: planState,
            planPresentation: self.planPresentation
        )
        self.subagentAction = subagentAction
        self.structuredUserInputRequest = structuredUserInputRequest
        self.orderIndex = orderIndex ?? ConstellagentMessageOrderCounter.next()
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case threadId
        case role
        case kind
        case assistantPhase
        case text
        case fileMentions
        case skillMentions
        case pluginMentions
        case createdAt
        case turnId
        case itemId
        case isStreaming
        case deliveryState
        case attachments
        case planState
        case planPresentation
        case proposedPlan
        case subagentAction
        case structuredUserInputRequest
        case orderIndex
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        threadId = try container.decode(String.self, forKey: .threadId)
        role = try container.decode(ConstellagentMessageRole.self, forKey: .role)
        kind = try container.decodeIfPresent(ConstellagentMessageKind.self, forKey: .kind) ?? .chat
        assistantPhase = try container.decodeIfPresent(String.self, forKey: .assistantPhase)
        text = try container.decode(String.self, forKey: .text)
        textRenderSignature = ConstellagentMessageTextRenderSignature(text: text)
        fileMentions = try container.decodeIfPresent([String].self, forKey: .fileMentions) ?? []
        skillMentions = try container.decodeIfPresent([String].self, forKey: .skillMentions) ?? []
        pluginMentions = try container.decodeIfPresent([String].self, forKey: .pluginMentions) ?? []
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        turnId = try container.decodeIfPresent(String.self, forKey: .turnId)
        itemId = try container.decodeIfPresent(String.self, forKey: .itemId)
        isStreaming = try container.decodeIfPresent(Bool.self, forKey: .isStreaming) ?? false
        deliveryState = try container.decodeIfPresent(ConstellagentMessageDeliveryState.self, forKey: .deliveryState) ?? .confirmed
        attachments = try container.decodeIfPresent([ConstellagentImageAttachment].self, forKey: .attachments) ?? []
        planState = try container.decodeIfPresent(ConstellagentPlanState.self, forKey: .planState)
        let decodedProposedPlan = try container.decodeIfPresent(ConstellagentProposedPlan.self, forKey: .proposedPlan)
        planPresentation = Self.derivedPlanPresentation(
            role: role,
            kind: kind,
            planState: planState,
            planPresentation: try container.decodeIfPresent(ConstellagentPlanPresentation.self, forKey: .planPresentation),
            itemId: itemId,
            proposedPlan: decodedProposedPlan
        )
        proposedPlan = decodedProposedPlan
            ?? Self.derivedProposedPlan(
                role: role,
                kind: kind,
                text: text,
                itemId: itemId,
                planState: planState,
                planPresentation: planPresentation
            )
        subagentAction = try container.decodeIfPresent(ConstellagentSubagentAction.self, forKey: .subagentAction)
        structuredUserInputRequest = try container.decodeIfPresent(
            ConstellagentStructuredUserInputRequest.self,
            forKey: .structuredUserInputRequest
        )
        orderIndex = try container.decodeIfPresent(Int.self, forKey: .orderIndex) ?? ConstellagentMessageOrderCounter.next()
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(threadId, forKey: .threadId)
        try container.encode(role, forKey: .role)
        try container.encode(kind, forKey: .kind)
        try container.encodeIfPresent(assistantPhase, forKey: .assistantPhase)
        try container.encode(text, forKey: .text)
        try container.encode(fileMentions, forKey: .fileMentions)
        try container.encode(skillMentions, forKey: .skillMentions)
        try container.encode(pluginMentions, forKey: .pluginMentions)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(turnId, forKey: .turnId)
        try container.encodeIfPresent(itemId, forKey: .itemId)
        try container.encode(isStreaming, forKey: .isStreaming)
        try container.encode(deliveryState, forKey: .deliveryState)
        try container.encode(attachments, forKey: .attachments)
        try container.encodeIfPresent(planState, forKey: .planState)
        try container.encodeIfPresent(planPresentation, forKey: .planPresentation)
        try container.encodeIfPresent(proposedPlan, forKey: .proposedPlan)
        try container.encodeIfPresent(subagentAction, forKey: .subagentAction)
        try container.encodeIfPresent(structuredUserInputRequest, forKey: .structuredUserInputRequest)
        try container.encode(orderIndex, forKey: .orderIndex)
    }

    static func == (lhs: ConstellagentMessage, rhs: ConstellagentMessage) -> Bool {
        lhs.id == rhs.id
            && lhs.threadId == rhs.threadId
            && lhs.role == rhs.role
            && lhs.kind == rhs.kind
            && lhs.assistantPhase == rhs.assistantPhase
            && lhs.text == rhs.text
            && lhs.fileMentions == rhs.fileMentions
            && lhs.skillMentions == rhs.skillMentions
            && lhs.pluginMentions == rhs.pluginMentions
            && lhs.createdAt == rhs.createdAt
            && lhs.turnId == rhs.turnId
            && lhs.itemId == rhs.itemId
            && lhs.isStreaming == rhs.isStreaming
            && lhs.deliveryState == rhs.deliveryState
            && lhs.attachments == rhs.attachments
            && lhs.planState == rhs.planState
            && lhs.planPresentation == rhs.planPresentation
            && lhs.proposedPlan == rhs.proposedPlan
            && lhs.subagentAction == rhs.subagentAction
            && lhs.structuredUserInputRequest == rhs.structuredUserInputRequest
            && lhs.orderIndex == rhs.orderIndex
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
        hasher.combine(threadId)
        hasher.combine(role)
        hasher.combine(kind)
        hasher.combine(assistantPhase)
        hasher.combine(text)
        hasher.combine(fileMentions)
        hasher.combine(skillMentions)
        hasher.combine(pluginMentions)
        hasher.combine(createdAt)
        hasher.combine(turnId)
        hasher.combine(itemId)
        hasher.combine(isStreaming)
        hasher.combine(deliveryState)
        hasher.combine(attachments)
        hasher.combine(planState)
        hasher.combine(planPresentation)
        hasher.combine(proposedPlan)
        hasher.combine(subagentAction)
        hasher.combine(structuredUserInputRequest)
        hasher.combine(orderIndex)
    }

    private static func derivedProposedPlan(
        role: ConstellagentMessageRole,
        kind: ConstellagentMessageKind,
        text: String,
        itemId: String?,
        planState: ConstellagentPlanState?,
        planPresentation: ConstellagentPlanPresentation?
    ) -> ConstellagentProposedPlan? {
        if role == .system && kind == .plan {
            let resolvedPresentation = derivedPlanPresentation(
                role: role,
                kind: kind,
                planState: planState,
                planPresentation: planPresentation,
                itemId: itemId,
                proposedPlan: nil
            )
            guard resolvedPresentation == .resultCompletedItem || resolvedPresentation == .resultReady else {
                return nil
            }

            return ConstellagentProposedPlanParser.parsePlanItem(from: text)
        }

        return ConstellagentProposedPlanParser.parse(from: text)
    }

    private static func derivedPlanPresentation(
        role: ConstellagentMessageRole,
        kind: ConstellagentMessageKind,
        planState: ConstellagentPlanState?,
        planPresentation: ConstellagentPlanPresentation?,
        itemId: String?,
        proposedPlan: ConstellagentProposedPlan?
    ) -> ConstellagentPlanPresentation? {
        guard role == .system, kind == .plan else {
            return nil
        }

        if let planPresentation {
            return planPresentation
        }

        let hasPlanSteps = !(planState?.steps.isEmpty ?? true)
        let hasExplanation = !(planState?.explanation?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        if hasPlanSteps || hasExplanation {
            return .progress
        }

        if let itemId, !itemId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // Older persisted plan-item rows may not include explicit presentation metadata.
            // If they already persisted a parsed proposed plan, recover them as ready; otherwise
            // keep them conservative until fresher runtime/history data reclassifies them.
            return proposedPlan == nil ? .resultClosed : .resultReady
        }

        return nil
    }

    var resolvedPlanPresentation: ConstellagentPlanPresentation? {
        Self.derivedPlanPresentation(
            role: role,
            kind: kind,
            planState: planState,
            planPresentation: planPresentation,
            itemId: itemId,
            proposedPlan: proposedPlan
        )
    }

}
