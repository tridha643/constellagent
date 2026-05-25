// FILE: AssistantDeltaMergeTests.swift
// Purpose: Verifies assistant delta merge preserves word spacing for Pi-style tokens.
// Layer: Unit Test
// Exports: AssistantDeltaMergeTests
// Depends on: XCTest, Constellagent

import XCTest
@testable import Constellagent

@MainActor
final class AssistantDeltaMergeTests: XCTestCase {
    private let service = ConstellagentService()

    func testMergeAssistantDeltaInsertsWordBoundariesForPiTokens() {
        var merged = ""
        for token in ["I'm", "an", "AI"] {
            merged = service.mergeAssistantDelta(existingText: merged, incomingDelta: token)
        }
        XCTAssertEqual(merged, "I'm an AI")
    }

    func testMergeAssistantDeltaAvoidsDoubleSpaces() {
        let merged = service.mergeAssistantDelta(existingText: "I'm", incomingDelta: " an")
        XCTAssertEqual(merged, "I'm an")
    }

    func testMergeAssistantDeltaHandlesCumulativeSnapshots() {
        let merged = service.mergeAssistantDelta(existingText: "Hello", incomingDelta: "Hello world")
        XCTAssertEqual(merged, "Hello world")
    }
}
