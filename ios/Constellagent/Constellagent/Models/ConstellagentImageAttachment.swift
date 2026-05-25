// FILE: ConstellagentImageAttachment.swift
// Purpose: Defines image attachment payload persisted in user chat messages.
// Layer: Model
// Exports: ConstellagentImageAttachment
// Depends on: Foundation

import Foundation

struct ConstellagentImageAttachment: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let thumbnailBase64JPEG: String
    let payloadDataURL: String?
    let sourceURL: String?
    let thumbnailContentFingerprint: ConstellagentTextContentFingerprint
    let payloadContentFingerprint: ConstellagentTextContentFingerprint?
    let sourceContentFingerprint: ConstellagentTextContentFingerprint?

    init(
        id: String = UUID().uuidString,
        thumbnailBase64JPEG: String,
        payloadDataURL: String? = nil,
        sourceURL: String? = nil
    ) {
        self.id = id
        self.thumbnailBase64JPEG = thumbnailBase64JPEG
        self.payloadDataURL = payloadDataURL
        self.sourceURL = sourceURL
        self.thumbnailContentFingerprint = ConstellagentTextContentFingerprint(thumbnailBase64JPEG)
        self.payloadContentFingerprint = payloadDataURL.map(ConstellagentTextContentFingerprint.init)
        self.sourceContentFingerprint = sourceURL.map(ConstellagentTextContentFingerprint.init)
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case thumbnailBase64JPEG
        case payloadDataURL
        case sourceURL
        case thumbnailContentFingerprint
        case payloadContentFingerprint
        case sourceContentFingerprint
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        thumbnailBase64JPEG = try container.decode(String.self, forKey: .thumbnailBase64JPEG)
        payloadDataURL = try container.decodeIfPresent(String.self, forKey: .payloadDataURL)
        sourceURL = try container.decodeIfPresent(String.self, forKey: .sourceURL)
        thumbnailContentFingerprint = try container.decodeIfPresent(
            ConstellagentTextContentFingerprint.self,
            forKey: .thumbnailContentFingerprint
        ) ?? ConstellagentTextContentFingerprint(thumbnailBase64JPEG)
        let decodedPayloadFingerprint = try container.decodeIfPresent(
            ConstellagentTextContentFingerprint.self,
            forKey: .payloadContentFingerprint
        )
        payloadContentFingerprint = payloadDataURL == nil
            ? nil
            : decodedPayloadFingerprint ?? payloadDataURL.map(ConstellagentTextContentFingerprint.init)
        let decodedSourceFingerprint = try container.decodeIfPresent(
            ConstellagentTextContentFingerprint.self,
            forKey: .sourceContentFingerprint
        )
        sourceContentFingerprint = sourceURL == nil
            ? nil
            : decodedSourceFingerprint ?? sourceURL.map(ConstellagentTextContentFingerprint.init)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(thumbnailBase64JPEG, forKey: .thumbnailBase64JPEG)
        try container.encodeIfPresent(payloadDataURL, forKey: .payloadDataURL)
        try container.encodeIfPresent(sourceURL, forKey: .sourceURL)
        try container.encode(thumbnailContentFingerprint, forKey: .thumbnailContentFingerprint)
        try container.encodeIfPresent(payloadContentFingerprint, forKey: .payloadContentFingerprint)
        try container.encodeIfPresent(sourceContentFingerprint, forKey: .sourceContentFingerprint)
    }

    // History rows only need a thumbnail and, when available, a lightweight remote URL.
    func sanitizedForStorage(preservingPayloadDataURL: Bool) -> ConstellagentImageAttachment {
        ConstellagentImageAttachment(
            id: id,
            thumbnailBase64JPEG: thumbnailBase64JPEG,
            payloadDataURL: preservingPayloadDataURL ? normalizedPayloadDataURL : nil,
            sourceURL: normalizedSourceURL
        )
    }

    // Keeps attachment matching stable without hashing giant inline data URLs.
    nonisolated var stableIdentityKey: String {
        if let normalizedSourceURL {
            return normalizedSourceURL
        }
        if !thumbnailBase64JPEG.isEmpty {
            return thumbnailBase64JPEG
        }
        if let normalizedPayloadDataURL {
            return normalizedPayloadDataURL
        }
        return id
    }

    nonisolated private var normalizedPayloadDataURL: String? {
        let trimmed = payloadDataURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    nonisolated private var normalizedSourceURL: String? {
        let trimmed = sourceURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty, !Self.isInlineImageDataURL(trimmed) else {
            return nil
        }
        return trimmed
    }

    nonisolated private static func isInlineImageDataURL(_ value: String) -> Bool {
        value.lowercased().hasPrefix("data:image")
    }
}
