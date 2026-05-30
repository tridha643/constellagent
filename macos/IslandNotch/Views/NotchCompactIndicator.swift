//  NotchCompactIndicator.swift
//  IslandNotch
//
//  Purpose: Compact-trailing affordance beside the notch. A faint, discoverable
//           "drop here" hint with a generous hit area, so dragging an image up to
//           the notch reliably catches and expands the shelf.
//  Layer: View

import SwiftUI

/// Compact-trailing pill beside the notch. Deliberately visible and finger-wide so
/// it's an easy, discoverable target to drag a screenshot onto. `isDropTargeted`
/// (driven from the parent's `.onDrop`) makes it glow + grow so the drag clearly
/// "catches", then the shelf expands.
struct NotchCompactIndicator: View {
    var isDropTargeted: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hinting = false

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(.white.opacity(isDropTargeted ? 1 : (hinting && !reduceMotion ? 0.7 : 0.45)))
        .frame(minWidth: 56, minHeight: 22)
        .background(
            Capsule(style: .continuous)
                .fill(Color.accentColor.opacity(isDropTargeted ? 0.85 : 0.0))
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(.white.opacity(isDropTargeted ? 0.0 : 0.18), lineWidth: 1)
                )
        )
        .contentShape(Capsule(style: .continuous))
        .scaleEffect(isDropTargeted && !reduceMotion ? 1.12 : 1.0)
        .accessibilityLabel("Screenshot shelf — drop images here")
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) {
                hinting = true
            }
        }
    }
}
