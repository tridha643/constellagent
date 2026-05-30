//  PermissionsSettingsView.swift
//  IslandNotch
//
//  Purpose: Shows live status for the two TCC permissions with one-click prompts
//           and deep links into System Settings. Everything degrades gracefully.
//  Layer: View

import SwiftUI

struct PermissionsSettingsView: View {
    @Environment(PermissionsService.self) private var permissions

    var body: some View {
        Form {
            Section {
                permissionRow(
                    title: "Screen Recording",
                    granted: permissions.screenRecordingGranted,
                    detail: "Required to capture screenshots. Takes effect after relaunch.",
                    settingsURL: SystemSettingsLinks.screenRecording,
                    request: { permissions.requestScreenRecording() }
                )
                permissionRow(
                    title: "Accessibility",
                    granted: permissions.accessibilityGranted,
                    detail: "Required only for the double-⌘ gesture.",
                    settingsURL: SystemSettingsLinks.accessibility,
                    request: { permissions.requestAccessibility() }
                )
            } header: {
                Text("Permissions")
            } footer: {
                Text("Grants are tied to the app's signed identity. If you re-sign with a different certificate, macOS may ask again.")
                    .font(.caption)
            }
        }
        .formStyle(.grouped)
        .onAppear { permissions.refresh() }
    }

    @ViewBuilder
    private func permissionRow(
        title: String,
        granted: Bool,
        detail: String,
        settingsURL: URL,
        request: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: granted ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundStyle(granted ? .green : .red)
                Text(title).fontWeight(.medium)
                Spacer()
                if !granted {
                    Button("Request") { request() }
                        .controlSize(.small)
                    Button("Open Settings") { SystemSettingsLinks.open(settingsURL) }
                        .controlSize(.small)
                }
            }
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
