// FILE: TurnTimelineCacheKeys.swift
// Purpose: Builds lightweight signatures for timeline render and block accessory caches.
// Layer: View Support
// Exports: TurnTimelineCacheKeyBuilder
// Depends on: Foundation, ConstellagentMessage

import Foundation

enum TurnTimelineCacheKeyBuilder {
    static func renderItemsSignature(
        threadID: String,
        timelineChangeToken: Int,
        visibleTailCount: Int,
        messages: ArraySlice<ConstellagentMessage>,
        completedTurnIDs: Set<String>
    ) -> TurnTimelineRenderItemsCacheSignature {
        var hasher = Hasher()
        hasher.combine(completedTurnIDs)
        return TurnTimelineRenderItemsCacheSignature(
            threadID: threadID,
            timelineChangeToken: timelineChangeToken,
            visibleTailCount: visibleTailCount,
            messageCount: messages.count,
            firstMessageID: messages.first?.id,
            lastMessageID: messages.last?.id,
            completedTurnIDsHash: hasher.finalize()
        )
    }

    // Avoid hashing message bodies while opening large threads; ConstellagentMessage keeps a
    // tiny text revision that changes whenever row text is mutated.
    static func blockInfoInputKey(
        messages: [ConstellagentMessage],
        isThreadRunning: Bool,
        isSendInFlight: Bool = false,
        activeTurnID: String?,
        latestTurnTerminalState: ConstellagentTurnTerminalState?,
        completedTurnIDs: Set<String>,
        stoppedTurnIDs: Set<String>,
        assistantRevertStatesByMessageID: [String: AssistantRevertPresentation]
    ) -> Int {
        var hasher = Hasher()
        hasher.combine(messages.count)
        hasher.combine(isThreadRunning)
        hasher.combine(isSendInFlight)
        hasher.combine(activeTurnID)
        hasher.combine(latestTurnTerminalState)
        hasher.combine(completedTurnIDs)
        hasher.combine(stoppedTurnIDs)
        hasher.combine(assistantRevertStatesByMessageID)

        for message in messages {
            hasher.combine(message.id)
            hasher.combine(message.role)
            hasher.combine(message.kind)
            hasher.combine(message.turnId)
            hasher.combine(message.isStreaming)
            hasher.combine(message.textRenderSignature)
        }

        return hasher.finalize()
    }
}
