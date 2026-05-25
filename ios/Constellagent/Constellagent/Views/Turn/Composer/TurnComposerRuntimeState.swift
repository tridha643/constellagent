// FILE: TurnComposerRuntimeState.swift
// Purpose: Bundles the composer runtime selection state shared by the bottom bar and input context menu.
// Layer: View Helper
// Exports: TurnComposerRuntimeState
// Depends on: ConstellagentService, TurnComposerMetaMapper, ConstellagentServiceTier

import Foundation

struct TurnComposerRuntimeState: Equatable {
    let reasoningDisplayOptions: [TurnComposerReasoningDisplayOption]
    let effectiveReasoningEffort: String?
    let selectedReasoningEffort: String?
    let reasoningMenuDisabled: Bool
    let selectedServiceTier: ConstellagentServiceTier?
    let supportsFastMode: Bool

    var selectedReasoningTitle: String {
        effectiveReasoningEffort.map(TurnComposerMetaMapper.reasoningTitle(for:)) ?? "Select reasoning"
    }

    var showsSpeedBadgeInModelMenu: Bool {
        supportsFastMode && selectedServiceTier != nil
    }

    func isSelectedReasoning(_ effort: String) -> Bool {
        (selectedReasoningEffort ?? effectiveReasoningEffort) == effort
    }

    func isSelectedServiceTier(_ serviceTier: ConstellagentServiceTier?) -> Bool {
        selectedServiceTier == serviceTier
    }

    static func resolve(
        constellagent: ConstellagentService,
        reasoningDisplayOptions: [TurnComposerReasoningDisplayOption]
    ) -> TurnComposerRuntimeState {
        return TurnComposerRuntimeState(
            reasoningDisplayOptions: reasoningDisplayOptions,
            effectiveReasoningEffort: constellagent.selectedReasoningEffortForSelectedModel(),
            selectedReasoningEffort: constellagent.selectedReasoningEffort,
            reasoningMenuDisabled: reasoningDisplayOptions.isEmpty || constellagent.selectedModelOption() == nil,
            selectedServiceTier: constellagent.effectiveServiceTier(),
            supportsFastMode: constellagent.selectedModelSupportsServiceTier(.fast)
        )
    }
}
