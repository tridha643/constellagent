//  DropZoneView.swift
//  IslandNotch
//
//  Purpose: Visual highlight shown while the user is dragging an image over the
//           notch shelf, signalling that a drop will be accepted.
//  Layer: View

import SwiftUI

struct DropZoneView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(
                Color.accentColor,
                style: StrokeStyle(lineWidth: 2, dash: [6, 4])
            )
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.accentColor.opacity(0.12))
            )
            .overlay {
                Label("Drop to add", systemImage: "square.and.arrow.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
            }
            .allowsHitTesting(false)
    }
}
