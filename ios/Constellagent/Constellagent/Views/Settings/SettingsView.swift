// FILE: SettingsView.swift
// Purpose: Settings for Local Mode (Constellagent runs on the paired computer, relay WebSocket).
// Layer: View
// Exports: SettingsView

import SwiftUI
import UIKit

struct SettingsView: View {
    @AppStorage("constellagent.appFontStyle") private var appFontStyleRawValue = AppFont.defaultStoredStyleRawValue

    var body: some View {
        List {
            SettingsArchivedChatsCard()
            SettingsAppearanceCard(appFontStyle: appFontStyleBinding)
            SettingsNotificationsCard()
            SettingsGPTAccountCard()
            SettingsBridgeVersionCard()
            SettingsRuntimeDefaultsCard()
            SettingsAboutCard()
            SettingsUsageCard()
            SettingsConnectionCard()
        }
        .listStyle(.insetGrouped)
        .font(AppFont.body())
        .tint(.primary)
        .navigationTitle("Settings")
    }

    private var appFontStyleBinding: Binding<AppFont.Style> {
        Binding(
            get: { AppFont.Style(rawValue: appFontStyleRawValue) ?? AppFont.defaultStyle },
            set: { appFontStyleRawValue = $0.rawValue }
        )
    }
}

private struct SettingsUsageCard: View {
    @Environment(ConstellagentService.self) private var constellagent
    @Environment(\.scenePhase) private var scenePhase

    @State private var isRefreshing = false

    var body: some View {
        SettingsCard(title: "Usage") {
            UsageStatusSummaryContent(
                contextWindowUsage: nil,
                showsContextWindowSection: false,
                rateLimitBuckets: constellagent.rateLimitBuckets,
                isLoadingRateLimits: constellagent.isLoadingRateLimits,
                rateLimitsErrorMessage: constellagent.rateLimitsErrorMessage,
                refreshControl: UsageStatusRefreshControl(
                    title: "Refresh",
                    isRefreshing: isRefreshing,
                    action: refreshStatus
                )
            )
        }
        .task {
            await refreshStatusIfNeeded()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await refreshStatusIfNeeded()
            }
        }
    }

    private func refreshStatus() {
        guard !isRefreshing else { return }
        HapticFeedback.shared.triggerImpactFeedback(style: .light)
        isRefreshing = true

        Task {
            await refreshStatusData()
            await MainActor.run {
                isRefreshing = false
            }
        }
    }

    private func refreshStatusIfNeeded() async {
        guard !isRefreshing else { return }
        guard constellagent.shouldAutoRefreshUsageStatus(threadId: nil) else { return }

        await MainActor.run {
            isRefreshing = true
        }
        await refreshStatusData()
        await MainActor.run {
            isRefreshing = false
        }
    }

    // Settings only needs the account-wide usage windows.
    private func refreshStatusData() async {
        await constellagent.refreshUsageStatus(threadId: nil)
    }
}

private struct SettingsAppearanceCard: View {
    @Binding var appFontStyle: AppFont.Style
    @AppStorage(GlassPreference.storageKey) private var useLiquidGlass = true
    @AppStorage(UserBubbleColor.storageKey) private var userBubbleColorRawValue = UserBubbleColor.defaultStoredRawValue
    private let settingsAccentColor = Color.primary

    var body: some View {
        SettingsCard(title: "Appearance") {
            Picker("Font", selection: $appFontStyle) {
                ForEach(AppFont.Style.allCases) { style in
                    Text(style.title).tag(style)
                }
            }
            .pickerStyle(.menu)
            .tint(settingsAccentColor)

            HStack {
                Text("Message Bubble")
                Menu {
                    ForEach(UserBubbleColor.allCases) { color in
                        Button {
                            userBubbleColorRawValue = color.rawValue
                        } label: {
                            Label {
                                Text(color.title)
                            } icon: {
                                Image(uiImage: color.menuSwatchImage)
                                    .renderingMode(.original)
                            }
                        }
                    }
                } label: {
                    HStack {
                        Spacer()
                        Circle()
                            .fill(selectedUserBubbleColor.swatchColor)
                            .frame(width: 14, height: 14)
                    }
                    .frame(maxWidth: .infinity, minHeight: 28, alignment: .trailing)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("Message Bubble color")
                .accessibilityValue(selectedUserBubbleColor.title)
                .tint(settingsAccentColor)
            }

            if GlassPreference.isSupported {
                Toggle("Liquid Glass", isOn: $useLiquidGlass)
                    .tint(settingsAccentColor)
            }

        }
    }

    private var selectedUserBubbleColor: UserBubbleColor {
        UserBubbleColor(rawValue: userBubbleColorRawValue) ?? .default
    }
}


private struct SettingsNotificationsCard: View {
    @Environment(ConstellagentService.self) private var constellagent
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        SettingsCard(title: "Notifications") {
            HStack(spacing: 10) {
                ConstellagentIcon.image(systemName: "bell.badge")
                    .foregroundStyle(.primary)
                Text("Status")
                Spacer()
                Text(statusLabel)
                    .foregroundStyle(.secondary)
            }

            Text("Used for local alerts when a run finishes while the app is in background.")
                .font(AppFont.caption())
                .foregroundStyle(.secondary)

            if constellagent.notificationAuthorizationStatus == .notDetermined {
                SettingsButton("Allow notifications") {
                    HapticFeedback.shared.triggerImpactFeedback()
                    Task {
                        await constellagent.requestNotificationPermission()
                    }
                }
            }

            if constellagent.notificationAuthorizationStatus == .denied {
                SettingsButton("Open iOS Settings") {
                    HapticFeedback.shared.triggerImpactFeedback()
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }
        }
        .task {
            await constellagent.refreshManagedNotificationRegistrationState()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else {
                return
            }
            Task {
                await constellagent.refreshManagedNotificationRegistrationState()
            }
        }
    }

    private var statusLabel: String {
        switch constellagent.notificationAuthorizationStatus {
        case .authorized: "Authorized"
        case .denied: "Denied"
        case .provisional: "Provisional"
        case .ephemeral: "Ephemeral"
        case .notDetermined: "Not requested"
        @unknown default: "Unknown"
        }
    }
}

private struct SettingsGPTAccountCard: View {
    @State private var isShowingMacLoginInfo = false

    var body: some View {
        SettingsCard(title: "ChatGPT voice mode") {
            Button {
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                isShowingMacLoginInfo = true
            } label: {
                HStack(spacing: 8) {
                    Label("Info", systemImage: "info.circle")
                        .foregroundStyle(.primary)
                    Spacer()
                    ConstellagentIcon.image(systemName: "chevron.right")
                        .font(AppFont.caption(weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .sheet(isPresented: $isShowingMacLoginInfo) {
            GPTVoiceSetupSheet()
        }
    }
}

private struct SettingsBridgeVersionCard: View {
    @Environment(ConstellagentService.self) private var constellagent
    @Environment(\.scenePhase) private var scenePhase
    @State private var isUpdatingBridge = false
    @State private var bridgeUpdateMessage: String?
    @State private var bridgeUpdateFailed = false

    var body: some View {
        SettingsCard(title: "Bridge Version") {
            HStack(spacing: 10) {
                Text("Status")
                Spacer()
                SettingsStatusPill(label: versionStatusLabel)
            }

            settingsVersionRow(
                title: "Installed on Device",
                value: installedVersionLabel,
                valueStyle: installedValueStyle
            )

            settingsVersionRow(
                title: "Latest available",
                value: latestVersionLabel,
                valueStyle: .primary
            )

            if let guidance = guidanceText {
                Text(guidance)
                    .font(AppFont.caption())
                    .foregroundStyle(guidanceColor)
            }

            if constellagent.supportsBridgePackageUpdate {
                SettingsButton(bridgeUpdateButtonTitle, isLoading: isUpdatingBridge) {
                    Task {
                        await updateBridgeFromSettings()
                    }
                }
                .disabled(!constellagent.isConnected || isUpdatingBridge)
            }

            if let bridgeUpdateMessage {
                Text(bridgeUpdateMessage)
                    .font(AppFont.caption())
                    .foregroundStyle(bridgeUpdateFailed ? .orange : .secondary)
            }
        }
        .task {
            await constellagent.refreshBridgeVersionState()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await constellagent.refreshBridgeVersionState()
            }
        }
    }

    private var installedVersionLabel: String {
        normalizedVersion(constellagent.bridgeInstalledVersion) ?? "Unknown"
    }

    private var latestVersionLabel: String {
        normalizedVersion(constellagent.latestBridgePackageVersion) ?? "Unknown"
    }

    private var guidanceText: String? {
        guard let installedVersion else {
            return "Connect to a device bridge to read the installed package version."
        }

        guard let latestVersion else {
            return "Installed version detected. The latest published package is unavailable right now."
        }

        if installedVersion == latestVersion {
            return "The installed bridge matches the latest published package."
        }

        if installedVersion.compare(latestVersion, options: .numeric) == .orderedAscending {
            return "A newer Constellagent package is available on npm."
        }

        return "This device is running a different build than the current npm latest."
    }

    private var versionStatusLabel: String {
        guard let installedVersion else {
            return "Unknown"
        }

        guard let latestVersion else {
            return "Installed"
        }

        if installedVersion == latestVersion {
            return "Up to date"
        }

        if installedVersion.compare(latestVersion, options: .numeric) == .orderedAscending {
            return "Update available"
        }

        return "Different build"
    }

    private var guidanceColor: Color {
        guard let installedVersion,
              let latestVersion,
              installedVersion.compare(latestVersion, options: .numeric) == .orderedAscending else {
            return .secondary
        }

        return .orange
    }

    private var bridgeUpdateButtonTitle: String {
        if let installedVersion,
           let latestVersion,
           installedVersion.compare(latestVersion, options: .numeric) == .orderedAscending {
            return "Update Bridge on Device"
        }

        return "Reinstall Bridge on Device"
    }

    private var installedValueStyle: Color {
        guard let installedVersion,
              let latestVersion,
              installedVersion.compare(latestVersion, options: .numeric) == .orderedAscending else {
            return .primary
        }

        return .orange
    }

    private var installedVersion: String? {
        normalizedVersion(constellagent.bridgeInstalledVersion)
    }

    private var latestVersion: String? {
        normalizedVersion(constellagent.latestBridgePackageVersion)
    }

    private func updateBridgeFromSettings() async {
        guard constellagent.isConnected else {
            bridgeUpdateFailed = true
            bridgeUpdateMessage = "Connect to your paired device first."
            return
        }

        guard !isUpdatingBridge else {
            return
        }

        isUpdatingBridge = true
        bridgeUpdateMessage = nil
        bridgeUpdateFailed = false

        do {
            let handoffService = DesktopHandoffService(constellagent: constellagent)
            try await handoffService.updateBridgePackageAndRestart()
            bridgeUpdateFailed = false
            bridgeUpdateMessage = "Bridge updated. Reconnecting after restart..."
        } catch {
            bridgeUpdateFailed = true
            bridgeUpdateMessage = error.localizedDescription
        }

        isUpdatingBridge = false
    }

    private func normalizedVersion(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }

        return trimmed
    }

    private func settingsVersionRow(title: String, value: String, valueStyle: Color) -> some View {
        HStack(spacing: 12) {
            Text(title)
            Spacer()
            Text(value)
                .font(AppFont.mono(.subheadline))
                .foregroundStyle(valueStyle)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
    }
}

private struct SettingsArchivedChatsCard: View {
    @Environment(ConstellagentService.self) private var constellagent

    private var archivedCount: Int {
        constellagent.threads.filter { $0.syncState == .archivedLocal }.count
    }

    var body: some View {
        SettingsCard(title: "Archived Chats") {
            NavigationLink {
                ArchivedChatsView()
            } label: {
                HStack {
                    ConstellagentIcon.label("Archived Chats", systemName: "archivebox")
                    Spacer()
                    if archivedCount > 0 {
                        Text("\(archivedCount)")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environment(ConstellagentService())
    }
}
