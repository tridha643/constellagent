// FILE: MyDevicesPresentation.swift
// Purpose: Shared device naming, status copy, and sort order for the
//          Connections sheet's active-device picker and per-device rows.
// Layer: View helper
// Exports: MyDevicesPresentation, MyDeviceRowModel, MyDeviceMenuVisibilityStore
// Depends on: ConstellagentService, SidebarComputerNicknameStore

import Foundation

struct MyDeviceRowModel: Identifiable {
    let deviceId: String
    let primaryName: String
    let secondaryName: String?
    let status: String
    let detail: String?
    let isCurrent: Bool
    let isConnected: Bool
    let isSwitching: Bool
    let isVisibleInMenu: Bool

    var id: String { deviceId }

    var menuSubtitle: String {
        [status, detail].compactMap { value in
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed?.isEmpty == false ? trimmed : nil
        }
        .joined(separator: " · ")
    }

    /// Short label for connection UI where full hostnames feel noisy.
    var compactDisplayName: String {
        MyDevicesPresentation.compactDisplayName(primaryName)
    }
}

enum MyDevicesPresentation {
    static let macIconSystemName = "desktopcomputer"

    static func compactDisplayName(_ rawName: String) -> String {
        let trimmed = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Device" }

        if trimmed.lowercased().hasSuffix(".local") {
            return String(trimmed.dropLast(6))
        }
        return trimmed
    }

    static func sortedRecords(from constellagent: ConstellagentService) -> [ConstellagentTrustedMacRecord] {
        constellagent.presentationTrustedMacRecords().sorted { lhs, rhs in
            shouldSortBefore(lhs, rhs, constellagent: constellagent)
        }
    }

    static func rowModels(from constellagent: ConstellagentService, switchingDeviceId: String?) -> [MyDeviceRowModel] {
        sortedRecords(from: constellagent).map { record in
            rowModel(for: record, constellagent: constellagent, switchingDeviceId: switchingDeviceId)
        }
    }

    static func rowModel(
        for trustedMac: ConstellagentTrustedMacRecord,
        constellagent: ConstellagentService,
        switchingDeviceId: String?
    ) -> MyDeviceRowModel {
        let identity = displayIdentity(for: trustedMac)
        return MyDeviceRowModel(
            deviceId: trustedMac.macDeviceId,
            primaryName: identity.primaryName,
            secondaryName: identity.secondaryName,
            status: statusLabel(for: trustedMac, constellagent: constellagent, switchingDeviceId: switchingDeviceId),
            detail: detailLabel(for: trustedMac, switchingDeviceId: switchingDeviceId),
            isCurrent: trustedMac.macDeviceId == constellagent.normalizedCurrentTrustedMacDeviceId,
            isConnected: trustedMac.macDeviceId == constellagent.normalizedRelayMacDeviceId && constellagent.isConnected,
            isSwitching: trustedMac.macDeviceId == switchingDeviceId,
            isVisibleInMenu: MyDeviceMenuVisibilityStore.isVisible(trustedMac.macDeviceId)
        )
    }

    private static func displayIdentity(for trustedMac: ConstellagentTrustedMacRecord) -> (primaryName: String, secondaryName: String?) {
        let nickname = SidebarComputerNicknameStore.nickname(for: trustedMac.macDeviceId)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let systemName = trustedMac.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)

        if !nickname.isEmpty, let systemName, !systemName.isEmpty {
            return (nickname, systemName)
        }

        if !nickname.isEmpty {
            return (nickname, nil)
        }

        if let systemName, !systemName.isEmpty {
            return (systemName, nil)
        }

        return ("Device", nil)
    }

    private static func statusLabel(
        for trustedMac: ConstellagentTrustedMacRecord,
        constellagent: ConstellagentService,
        switchingDeviceId: String?
    ) -> String {
        if trustedMac.macDeviceId == switchingDeviceId {
            return "Switching"
        }
        if trustedMac.macDeviceId == constellagent.normalizedRelayMacDeviceId && constellagent.isConnected {
            return "Connected"
        }
        if trustedMac.macDeviceId == constellagent.normalizedCurrentTrustedMacDeviceId {
            return "Selected"
        }
        if trustedMac.macDeviceId == constellagent.normalizedPreviousTrustedMacDeviceId {
            return "Previous"
        }
        return "Saved"
    }

    private static func detailLabel(
        for trustedMac: ConstellagentTrustedMacRecord,
        switchingDeviceId: String?
    ) -> String? {
        if trustedMac.macDeviceId == switchingDeviceId {
            return "Reloading chats"
        }

        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        let referenceDate = trustedMac.lastUsedAt ?? trustedMac.lastPairedAt
        return formatter.localizedString(for: referenceDate, relativeTo: Date())
    }

    private static func shouldSortBefore(
        _ lhs: ConstellagentTrustedMacRecord,
        _ rhs: ConstellagentTrustedMacRecord,
        constellagent: ConstellagentService
    ) -> Bool {
        let lhsIsCurrent = lhs.macDeviceId == constellagent.normalizedCurrentTrustedMacDeviceId
        let rhsIsCurrent = rhs.macDeviceId == constellagent.normalizedCurrentTrustedMacDeviceId
        if lhsIsCurrent != rhsIsCurrent {
            return lhsIsCurrent
        }

        let lhsIsRelay = lhs.macDeviceId == constellagent.normalizedRelayMacDeviceId
        let rhsIsRelay = rhs.macDeviceId == constellagent.normalizedRelayMacDeviceId
        if lhsIsRelay != rhsIsRelay {
            return lhsIsRelay
        }

        let lhsIsPrevious = lhs.macDeviceId == constellagent.normalizedPreviousTrustedMacDeviceId
        let rhsIsPrevious = rhs.macDeviceId == constellagent.normalizedPreviousTrustedMacDeviceId
        if lhsIsPrevious != rhsIsPrevious {
            return lhsIsPrevious
        }

        let lhsHasResolvedSession = hasResolvedTrustedSession(lhs)
        let rhsHasResolvedSession = hasResolvedTrustedSession(rhs)
        if lhsHasResolvedSession != rhsHasResolvedSession {
            return lhsHasResolvedSession
        }

        return trustedMacActivityDate(lhs) > trustedMacActivityDate(rhs)
    }

    private static func hasResolvedTrustedSession(_ trustedMac: ConstellagentTrustedMacRecord) -> Bool {
        if trustedMac.lastResolvedAt != nil {
            return true
        }
        return trustedMac.lastResolvedSessionId?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty == false
    }

    private static func trustedMacActivityDate(_ trustedMac: ConstellagentTrustedMacRecord) -> Date {
        trustedMac.lastResolvedAt ?? trustedMac.lastUsedAt ?? trustedMac.lastPairedAt
    }
}

enum MyDeviceMenuVisibilityStore {
    private static let keyPrefix = "constellagent.myDevices.visibleInMenu."

    static func isVisible(_ deviceId: String?) -> Bool {
        guard let storageKey = storageKey(for: deviceId) else {
            return true
        }
        guard UserDefaults.standard.object(forKey: storageKey) != nil else {
            return true
        }
        return UserDefaults.standard.bool(forKey: storageKey)
    }

    static func setVisible(_ isVisible: Bool, for deviceId: String?) {
        guard let storageKey = storageKey(for: deviceId) else {
            return
        }
        UserDefaults.standard.set(isVisible, forKey: storageKey)
    }

    static func removePreference(for deviceId: String?) {
        guard let storageKey = storageKey(for: deviceId) else {
            return
        }
        UserDefaults.standard.removeObject(forKey: storageKey)
    }

    private static func storageKey(for deviceId: String?) -> String? {
        guard let deviceId = deviceId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !deviceId.isEmpty else {
            return nil
        }
        return keyPrefix + deviceId
    }
}
