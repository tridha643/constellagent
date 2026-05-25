// FILE: TurnComposerRuntimeActions.swift
// Purpose: Centralizes the composer runtime selection callbacks shared across nested views.
// Layer: View Helper
// Exports: TurnComposerRuntimeActions
// Depends on: ConstellagentService, ConstellagentServiceTier

import Foundation

struct TurnComposerRuntimeActions {
    let selectModel: (String) -> Void
    let selectAutomaticReasoning: () -> Void
    let selectReasoning: (String) -> Void
    let selectServiceTier: (ConstellagentServiceTier?) -> Void

    static func resolve(constellagent: ConstellagentService) -> TurnComposerRuntimeActions {
        TurnComposerRuntimeActions(
            selectModel: constellagent.setSelectedModelId,
            selectAutomaticReasoning: { constellagent.setSelectedReasoningEffort(nil) },
            selectReasoning: { effort in constellagent.setSelectedReasoningEffort(effort) },
            selectServiceTier: constellagent.setSelectedServiceTier
        )
    }
}
