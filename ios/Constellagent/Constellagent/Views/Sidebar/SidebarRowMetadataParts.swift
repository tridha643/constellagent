// FILE: SidebarRowMetadataParts.swift
// Purpose: Small reusable pieces of trailing metadata used by sidebar thread
//          rows (timestamp label and refresh hint). Parent and subagent rows
//          rendered visually different captions inline; collecting them here
//          keeps font and accessibility behavior in one place per size.
// Layer: View Component
// Exports: SidebarTimingLabel, SidebarTimestampRefreshIndicator,
//          SidebarRowMetricsSize
// Depends on: SwiftUI, ConstellagentIcon, AppFont

import SwiftUI

/// Caption size class shared by the trailing metadata of parent and subagent
/// rows. Parent rows use footnote sizing with a fixed trailing width so badges
/// align; subagent rows use the smaller caption with no fixed width.
enum SidebarRowMetricsSize {
    case parent
    case subagent

    var font: Font {
        switch self {
        case .parent: AppFont.footnote()
        case .subagent: AppFont.caption()
        }
    }

    /// Trailing slot width applied so the timestamp / refresh hint / run badge
    /// occupy the same column in parent rows. Subagent rows let the caption
    /// size naturally.
    var trailingSlotWidth: CGFloat? {
        switch self {
        case .parent: 28
        case .subagent: nil
        }
    }
}

struct SidebarTimingLabel: View {
    let text: String
    let size: SidebarRowMetricsSize

    var body: some View {
        Text(text)
            .font(size.font)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .modifier(SidebarTrailingSlotWidth(size: size))
    }
}

struct SidebarTimestampRefreshIndicator: View {
    let size: SidebarRowMetricsSize

    var body: some View {
        ConstellagentIcon.image(systemName: "info.circle")
            .font(size.font)
            .foregroundStyle(.secondary)
            .modifier(SidebarTrailingSlotWidth(size: size))
            .accessibilityLabel("Open chat to refresh timestamp")
    }
}

private struct SidebarTrailingSlotWidth: ViewModifier {
    let size: SidebarRowMetricsSize

    func body(content: Content) -> some View {
        if let width = size.trailingSlotWidth {
            content.frame(width: width, alignment: .trailing)
        } else {
            content
        }
    }
}
