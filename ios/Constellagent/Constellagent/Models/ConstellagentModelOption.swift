// FILE: ConstellagentModelOption.swift
// Purpose: Represents one model entry returned by model/list.
// Layer: Model
// Exports: ConstellagentModelOption
// Depends on: Foundation, ConstellagentReasoningEffortOption, ConstellagentServiceTier

import Foundation

struct ConstellagentModelOption: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let model: String
    let displayName: String
    let description: String
    let isDefault: Bool
    let supportsFastMode: Bool
    let supportedReasoningEfforts: [ConstellagentReasoningEffortOption]
    let defaultReasoningEffort: String?

    init(
        id: String,
        model: String,
        displayName: String,
        description: String,
        isDefault: Bool,
        supportsFastMode: Bool = false,
        supportedReasoningEfforts: [ConstellagentReasoningEffortOption],
        defaultReasoningEffort: String?
    ) {
        self.id = id
        self.model = model
        self.displayName = displayName
        self.description = description
        self.isDefault = isDefault
        self.supportsFastMode = supportsFastMode
        self.supportedReasoningEfforts = supportedReasoningEfforts
        self.defaultReasoningEffort = defaultReasoningEffort
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case model
        case slug
        case name
        case displayName
        case displayNameSnake = "display_name"
        case description
        case isDefault
        case isDefaultSnake = "is_default"
        case supportsFastMode
        case supportsFastModeSnake = "supports_fast_mode"
        case fastMode
        case fastModeSnake = "fast_mode"
        case fastServiceTier
        case fastServiceTierSnake = "fast_service_tier"
        case additionalSpeedTiers
        case additionalSpeedTiersSnake = "additional_speed_tiers"
        case supportedReasoningEfforts
        case supportedReasoningEffortsSnake = "supported_reasoning_efforts"
        case defaultReasoningEffort
        case defaultReasoningEffortSnake = "default_reasoning_effort"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        let modelValue = try container.decodeIfPresent(String.self, forKey: .model)
        let slugValue = try container.decodeIfPresent(String.self, forKey: .slug)
        let idValue = try container.decodeIfPresent(String.self, forKey: .id)
        let rawModel = modelValue ?? slugValue ?? idValue ?? ""
        let normalizedModel = rawModel.trimmingCharacters(in: .whitespacesAndNewlines)

        let rawID = idValue ?? slugValue ?? normalizedModel

        let normalizedID = rawID.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayNameValue = try container.decodeIfPresent(String.self, forKey: .displayName)
        let displayNameSnakeValue = try container.decodeIfPresent(String.self, forKey: .displayNameSnake)
        let nameValue = try container.decodeIfPresent(String.self, forKey: .name)
        let rawDisplayName = displayNameValue ?? displayNameSnakeValue ?? nameValue ?? normalizedModel

        let normalizedDisplayName = rawDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawDescription = (try container.decodeIfPresent(String.self, forKey: .description)) ?? ""

        let camelEfforts = try container.decodeIfPresent(
            [ConstellagentReasoningEffortOption].self,
            forKey: .supportedReasoningEfforts
        )
        let snakeEfforts = try container.decodeIfPresent(
            [ConstellagentReasoningEffortOption].self,
            forKey: .supportedReasoningEffortsSnake
        )
        let efforts = camelEfforts ?? snakeEfforts ?? []

        let normalizedEfforts = efforts.filter {
            !$0.reasoningEffort.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        let camelDefaultEffort = try container.decodeIfPresent(String.self, forKey: .defaultReasoningEffort)
        let snakeDefaultEffort = try container.decodeIfPresent(String.self, forKey: .defaultReasoningEffortSnake)
        let defaultEffort = camelDefaultEffort ?? snakeDefaultEffort

        let camelDefaultFlag = try container.decodeIfPresent(Bool.self, forKey: .isDefault)
        let snakeDefaultFlag = try container.decodeIfPresent(Bool.self, forKey: .isDefaultSnake)
        let explicitFastMode = Self.decodeExplicitFastMode(from: container)
        let additionalSpeedTiers = Self.decodeAdditionalSpeedTiers(from: container)

        id = normalizedID.isEmpty ? normalizedModel : normalizedID
        model = normalizedModel
        displayName = normalizedDisplayName.isEmpty ? normalizedModel : normalizedDisplayName
        description = rawDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        isDefault = camelDefaultFlag ?? snakeDefaultFlag ?? false
        supportsFastMode = ConstellagentModelCapabilityResolver.supportsFastMode(
            model: normalizedModel,
            id: normalizedID,
            explicitFastMode: explicitFastMode,
            additionalSpeedTiers: additionalSpeedTiers
        )
        supportedReasoningEfforts = normalizedEfforts

        let normalizedDefault = defaultEffort?.trimmingCharacters(in: .whitespacesAndNewlines)
        defaultReasoningEffort = (normalizedDefault?.isEmpty == true) ? nil : normalizedDefault
    }

    // Constellagent model/list has shipped several field spellings; keep this parser
    // data-driven so the main decoder stays small enough for Swift's type checker.
    private static func decodeExplicitFastMode(
        from container: KeyedDecodingContainer<CodingKeys>
    ) -> Bool? {
        let keys: [CodingKeys] = [
            .supportsFastMode,
            .supportsFastModeSnake,
            .fastMode,
            .fastModeSnake,
            .fastServiceTier,
            .fastServiceTierSnake,
        ]

        for key in keys {
            if let value = try? container.decodeIfPresent(Bool.self, forKey: key) {
                return value
            }
        }
        return nil
    }

    private static func decodeAdditionalSpeedTiers(
        from container: KeyedDecodingContainer<CodingKeys>
    ) -> [String] {
        let camelTiers = (try? container.decodeIfPresent([String].self, forKey: .additionalSpeedTiers)) ?? []
        let snakeTiers = (try? container.decodeIfPresent([String].self, forKey: .additionalSpeedTiersSnake)) ?? []
        return camelTiers + snakeTiers
    }

    func supportsServiceTier(_ serviceTier: ConstellagentServiceTier) -> Bool {
        switch serviceTier {
        case .fast:
            return supportsFastMode
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(model, forKey: .model)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(description, forKey: .description)
        try container.encode(isDefault, forKey: .isDefault)
        try container.encode(supportsFastMode, forKey: .supportsFastMode)
        try container.encode(supportedReasoningEfforts, forKey: .supportedReasoningEfforts)
        try container.encodeIfPresent(defaultReasoningEffort, forKey: .defaultReasoningEffort)
    }
}

private enum ConstellagentModelCapabilityResolver {
    // Mirrors the desktop capability table only when older bridges omit explicit model speed metadata.
    private static let staticFastModeModelIdentifiers: Set<String> = [
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.2-constellagent",
        "gpt-5.2",
    ]

    static func supportsFastMode(
        model: String,
        id: String,
        explicitFastMode: Bool?,
        additionalSpeedTiers: [String]
    ) -> Bool {
        if let explicitFastMode {
            return explicitFastMode
        }
        if supportsServiceTier(.fast, in: additionalSpeedTiers) {
            return true
        }
        return staticFastModeFallback(for: [model, id])
    }

    private static func supportsServiceTier(
        _ serviceTier: ConstellagentServiceTier,
        in additionalSpeedTiers: [String]
    ) -> Bool {
        additionalSpeedTiers.contains { tier in
            tier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == serviceTier.rawValue
        }
    }

    private static func staticFastModeFallback(for identifiers: [String]) -> Bool {
        identifiers.contains { identifier in
            staticFastModeModelIdentifiers.contains(
                identifier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            )
        }
    }
}
