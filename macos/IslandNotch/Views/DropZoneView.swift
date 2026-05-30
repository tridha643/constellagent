//  DropZoneView.swift
//  IslandNotch
//
//  Purpose: Visual highlight shown while the user is dragging an image over the
//           notch shelf, signalling that a drop will be accepted.
//  Layer: View

import SwiftUI

struct DropZoneView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Drives a subtle continuous "breathing" pulse so the target reads as live
    /// and receptive while the user hovers a drag over it.
    @State private var breathing = false

    var body: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(
                Color.accentColor,
                style: StrokeStyle(lineWidth: 2, dash: [6, 4])
            )
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.accentColor.opacity(breathing ? 0.20 : 0.12))
            )
            .overlay {
                VStack(spacing: 6) {
                    Image(systemName: "square.and.arrow.down.fill")
                        .font(.system(size: 22, weight: .semibold))
                        // The arrow gently bobs toward the shelf — "drop here".
                        .offset(y: breathing ? 2 : -2)
                    Text("Drop your image here")
                        .font(.system(.subheadline, design: .rounded).weight(.semibold))
                }
                .foregroundStyle(Color.accentColor)
                .padding(8)
            }
            .allowsHitTesting(false)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    breathing = true
                }
            }
    }
}
