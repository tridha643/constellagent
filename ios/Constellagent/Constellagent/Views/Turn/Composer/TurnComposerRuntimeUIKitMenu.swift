// FILE: TurnComposerRuntimeUIKitMenu.swift
// Purpose: Builds the hierarchical UIKit menu for the composer runtime pill
//          (Model / Intelligence / Speed) consumed by UIKitMenuButton.
// Layer: View Helper
// Exports: TurnComposerRuntimeUIKitMenuBuilder
// Depends on: UIKit, TurnComposerRuntimeState, TurnComposerRuntimeActions,
//             TurnComposerMetaMapper, ConstellagentModelOption, ConstellagentServiceTier,
//             HapticFeedback
//
// Design notes
// ------------
// * Top-level menu has three submenus: Model, Intelligence, Speed. Each parent
//   carries `subtitle:` (current selection) so the row renders as the
//   "Label / Value / >" pill you see in the screenshot.
// * Submenus use `UIMenu.Options.singleSelection` so UIKit draws/clears the
//   checkmarks for us. We pass `.on` for the active item as a hint; UIKit
//   reconciles state when singleSelection is set.
// * Long model lists keep the existing "featured + Other models…" split so the
//   menu stays glanceable. The "Other models" action opens the existing
//   SwiftUI sheet via an injected callback.

import UIKit

enum TurnComposerRuntimeUIKitMenuBuilder {

    struct Input {
        let runtimeState: TurnComposerRuntimeState
        let runtimeActions: TurnComposerRuntimeActions
        let orderedModelOptions: [ConstellagentModelOption]
        let selectedModelID: String?
        let selectedModelTitle: String
        let isLoadingModels: Bool
        let isRuntimeSelectionLoading: Bool
        let featuredModelIdentifiers: Set<String>
        let onRequestAllModelsSheet: () -> Void
    }

    static func makeMenu(_ input: Input) -> UIMenu {
        var children: [UIMenuElement] = []

        children.append(modelMenu(input))

        if let intelligenceMenu = intelligenceMenu(input) {
            children.append(intelligenceMenu)
        }

        if let speedMenu = speedMenu(input) {
            children.append(speedMenu)
        }

        return UIMenu(title: "", options: [.displayInline], children: children)
    }

    // MARK: - Model

    private static func modelMenu(_ input: Input) -> UIMenu {
        let subtitle: String
        if input.selectedModelID == nil {
            subtitle = input.isRuntimeSelectionLoading ? "Loading…" : "Select model"
        } else {
            subtitle = input.selectedModelTitle
        }

        let modelChildren: [UIMenuElement] = {
            if input.isLoadingModels {
                return [
                    disabledInfoAction(title: "Loading models…"),
                ]
            }
            if input.orderedModelOptions.isEmpty {
                return [
                    disabledInfoAction(title: "No models available"),
                ]
            }

            let featured = featuredOrderedModels(input)
            var items: [UIMenuElement] = featured.map { model in
                modelAction(model: model, input: input)
            }

            let hasOthers = input.orderedModelOptions.contains { model in
                !featured.contains(where: { $0.id == model.id })
            }
            if hasOthers {
                items.append(
                    UIAction(
                        title: "Other models…",
                        image: ConstellagentIcon.menuUIImage(systemName: "ellipsis")
                    ) { _ in
                        HapticFeedback.shared.triggerImpactFeedback(style: .light)
                        input.onRequestAllModelsSheet()
                    }
                )
            }
            return items
        }()

        // singleSelection paints the checkmark on the `.on` child for us.
        return UIMenu(
            title: "Model",
            subtitle: subtitle,
            image: ConstellagentIcon.menuUIImage(systemName: "cube"),
            options: [.singleSelection],
            children: modelChildren
        )
    }

    private static func modelAction(model: ConstellagentModelOption, input: Input) -> UIAction {
        let title = TurnComposerMetaMapper.modelTitle(for: model)
        let image: UIImage? = model.supportsServiceTier(.fast)
            ? UIImage(systemName: ConstellagentServiceTier.fast.iconName)
            : nil

        return UIAction(
            title: title,
            image: image,
            state: model.id == input.selectedModelID ? .on : .off
        ) { _ in
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
            input.runtimeActions.selectModel(model.id)
        }
    }

    private static func featuredOrderedModels(_ input: Input) -> [ConstellagentModelOption] {
        var seen = Set<String>()
        var result: [ConstellagentModelOption] = []

        for model in input.orderedModelOptions {
            let normalizedID = model.id.lowercased()
            let normalizedModel = model.model.lowercased()
            let isFeatured = input.featuredModelIdentifiers.contains(normalizedID)
                || input.featuredModelIdentifiers.contains(normalizedModel)
            guard isFeatured, seen.insert(model.id).inserted else { continue }
            result.append(model)
        }

        if let selectedID = input.selectedModelID,
           seen.insert(selectedID).inserted,
           let selected = input.orderedModelOptions.first(where: { $0.id == selectedID }) {
            result.append(selected)
        }
        return result
    }

    // MARK: - Intelligence (reasoning effort)

    private static func intelligenceMenu(_ input: Input) -> UIMenu? {
        let options = input.runtimeState.reasoningDisplayOptions
        guard !options.isEmpty else { return nil }

        let actions: [UIMenuElement] = options.map { option in
            let action = UIAction(
                title: option.title,
                state: input.runtimeState.isSelectedReasoning(option.effort) ? .on : .off
            ) { _ in
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                input.runtimeActions.selectReasoning(option.effort)
            }
            if input.runtimeState.reasoningMenuDisabled {
                action.attributes.insert(.disabled)
            }
            return action
        }

        return UIMenu(
            title: "Intelligence",
            subtitle: input.runtimeState.selectedReasoningTitle,
            image: ConstellagentIcon.menuUIImage(systemName: "brain"),
            options: [.singleSelection],
            children: actions
        )
    }

    // MARK: - Speed

    private static func speedMenu(_ input: Input) -> UIMenu? {
        guard input.runtimeState.supportsFastMode else { return nil }

        let normalAction = UIAction(
            title: "Normal",
            state: input.runtimeState.isSelectedServiceTier(nil) ? .on : .off
        ) { _ in
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
            input.runtimeActions.selectServiceTier(nil)
        }

        let tierActions: [UIMenuElement] = ConstellagentServiceTier.allCases.map { tier in
            UIAction(
                title: tier.displayName,
                // Keep the Fast tier on the native SF bolt to match the speed
                // badge in the composer; other tiers can use Central artwork.
                image: tier == .fast
                    ? UIImage(systemName: tier.iconName)
                    : ConstellagentIcon.menuUIImage(systemName: tier.iconName),
                state: input.runtimeState.isSelectedServiceTier(tier) ? .on : .off
            ) { _ in
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                input.runtimeActions.selectServiceTier(tier)
            }
        }

        let subtitle: String = {
            if let tier = input.runtimeState.selectedServiceTier {
                return tier.displayName
            }
            return "Normal"
        }()

        return UIMenu(
            title: "Speed",
            subtitle: subtitle,
            image: UIImage(systemName: "bolt.fill"),
            options: [.singleSelection],
            children: [normalAction] + tierActions
        )
    }

    // MARK: - Helpers

    private static func disabledInfoAction(title: String) -> UIAction {
        let action = UIAction(title: title) { _ in }
        action.attributes.insert(.disabled)
        return action
    }
}
