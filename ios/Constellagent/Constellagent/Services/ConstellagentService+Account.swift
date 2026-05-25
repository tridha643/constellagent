// FILE: ConstellagentService+Account.swift
// Purpose: Owns ChatGPT account state, browser-login lifecycle, and sanitized bridge refreshes.
// Layer: Service
// Exports: ConstellagentGPTAccountSnapshot, ConstellagentGPTLoginState, ConstellagentService GPT account helpers
// Depends on: Foundation, RPCMessage, JSONValue

import Foundation

private let minimumBridgePackageUpdateCommand = "npm install -g constellagent@latest"
private let forcedBridgeUpgradeFromVersion = "1.3.8"
private let forcedBridgeUpgradeTargetVersion = "1.3.9"
private let forcedBridgeUpgradeCommand = "npm install -g constellagent@1.3.9"

enum ConstellagentGPTAccountStatus: String, Codable, Sendable {
    case unknown
    case unavailable
    case notLoggedIn
    case loginPending
    case authenticated
    case expired
}

enum ConstellagentGPTAuthMethod: String, Codable, Sendable {
    case chatgpt
}

struct ConstellagentGPTAccountSnapshot: Codable, Equatable, Sendable {
    var status: ConstellagentGPTAccountStatus
    var authMethod: ConstellagentGPTAuthMethod?
    var email: String?
    var displayName: String?
    var planType: String?
    var hostPlatform: ConstellagentBridgeHostPlatform? = nil
    var hostCapabilities: ConstellagentBridgeHostCapabilities? = nil
    var loginInFlight: Bool
    var needsReauth: Bool
    var expiresAt: Date?
    var tokenReady: Bool? = nil
    var tokenUnavailableSince: Date? = nil
    var updatedAt: Date

    var hasActiveLogin: Bool {
        loginInFlight || status == .loginPending
    }

    var isAuthenticated: Bool {
        status == .authenticated && !needsReauth
    }

    var canLogout: Bool {
        isAuthenticated || needsReauth
    }

    var isVoiceTokenReady: Bool {
        tokenReady ?? isAuthenticated
    }

    var statusLabel: String {
        switch status {
        case .unknown:
            return "Unknown"
        case .unavailable:
            return "Unavailable"
        case .notLoggedIn:
            return "Not logged in"
        case .loginPending:
            return "Login pending"
        case .authenticated:
            return needsReauth ? "Needs reauth" : "Authenticated"
        case .expired:
            return "Expired"
        }
    }

    var detailText: String? {
        var parts: [String] = []
        if let email, !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parts.append(email)
        }
        if let planType, !planType.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parts.append(planType.capitalized)
        }
        if let expiresAt {
            parts.append(Self.expiryFormatter.string(from: expiresAt))
        }
        if isAuthenticated && !isVoiceTokenReady {
            parts.append("Voice syncing")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " • ")
    }

    static let voiceTokenGraceInterval: TimeInterval = 45

    private static let expiryFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
}

enum ConstellagentBridgeHostPlatform: String, Codable, Sendable {
    case macOS = "macos"
    case linux
    case windows
    case unknown

    var displayName: String {
        switch self {
        case .macOS:
            return "Device"
        case .linux:
            return "Linux device"
        case .windows:
            return "Windows device"
        case .unknown:
            return "device"
        }
    }
}

struct ConstellagentBridgeHostCapabilities: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case desktopHandoff
        case displayWake
        case keepAwake
        case hostBrowserLogin
        case terminal
        case bridgeUpdate
    }

    var desktopHandoff: Bool = false
    var displayWake: Bool = false
    var keepAwake: Bool = false
    var hostBrowserLogin: Bool = false
    var terminal: Bool = false
    var bridgeUpdate: Bool = false

    init(
        desktopHandoff: Bool = false,
        displayWake: Bool = false,
        keepAwake: Bool = false,
        hostBrowserLogin: Bool = false,
        terminal: Bool = false,
        bridgeUpdate: Bool = false
    ) {
        self.desktopHandoff = desktopHandoff
        self.displayWake = displayWake
        self.keepAwake = keepAwake
        self.hostBrowserLogin = hostBrowserLogin
        self.terminal = terminal
        self.bridgeUpdate = bridgeUpdate
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        desktopHandoff = try container.decodeIfPresent(Bool.self, forKey: .desktopHandoff) ?? false
        displayWake = try container.decodeIfPresent(Bool.self, forKey: .displayWake) ?? false
        keepAwake = try container.decodeIfPresent(Bool.self, forKey: .keepAwake) ?? false
        hostBrowserLogin = try container.decodeIfPresent(Bool.self, forKey: .hostBrowserLogin) ?? false
        terminal = try container.decodeIfPresent(Bool.self, forKey: .terminal) ?? false
        bridgeUpdate = try container.decodeIfPresent(Bool.self, forKey: .bridgeUpdate) ?? false
    }

    static let legacyMacOS = ConstellagentBridgeHostCapabilities(
        desktopHandoff: true,
        displayWake: true,
        keepAwake: true,
        hostBrowserLogin: true,
        terminal: false
    )
}

nonisolated func constellagentGPTAccountInitialSnapshot() -> ConstellagentGPTAccountSnapshot {
    ConstellagentGPTAccountSnapshot(
        status: .unknown,
        authMethod: nil,
        email: nil,
        displayName: nil,
        planType: nil,
        hostPlatform: nil,
        hostCapabilities: nil,
        loginInFlight: false,
        needsReauth: false,
        expiresAt: nil,
        tokenReady: nil,
        tokenUnavailableSince: nil,
        updatedAt: .distantPast
    )
}

struct ConstellagentGPTLoginState: Codable, Equatable, Sendable {
    let loginId: String
    let authURL: String
    let createdAt: Date
    let expiresAt: Date?
}

struct ConstellagentGPTLoginCallbackState: Codable, Equatable, Sendable {
    let loginId: String
    let callbackURL: String
    let createdAt: Date
}

struct ConstellagentGPTLoginStartResult: Equatable, Sendable {
    let loginId: String
    let authURL: URL
    let expiresAt: Date?
}

extension ConstellagentService {
    static let legacyGPTLoginCallbackEnabled = true

    // Refreshes bridge-managed account + package metadata together for foreground/reconnect flows.
    func refreshBridgeManagedState(allowAvailableBridgeUpdatePrompt: Bool = false) async {
        guard isConnected else {
            applyGPTAccountConnectionFallback()
            return
        }

        do {
            let bridgeState = try await fetchBridgeManagedStatusSnapshot()
            applyBridgePackageStatus(
                from: bridgeState.payload,
                allowMissingVersionPrompt: bridgeState.allowMissingVersionPrompt,
                allowAvailableBridgeUpdatePrompt: allowAvailableBridgeUpdatePrompt
            )
            applyBridgeManagedAccountSnapshot(from: bridgeState.payload)
        } catch {
            handleBridgeManagedAccountRefreshFailure()
        }
    }

    // Refreshes the bridge-owned account snapshot without ever fetching GPT tokens on iPhone.
    func refreshGPTAccountState() async {
        guard isConnected else {
            applyGPTAccountConnectionFallback()
            return
        }

        do {
            let bridgeState = try await fetchBridgeManagedStatusSnapshot()
            applyBridgeManagedAccountSnapshot(from: bridgeState.payload)
        } catch {
            handleBridgeManagedAccountRefreshFailure()
        }
    }

    // Refreshes only the bridge package version state so Constellagent updates stay independent from GPT UX.
    func refreshBridgeVersionState(allowAvailableBridgeUpdatePrompt: Bool = false) async {
        guard isConnected else {
            return
        }

        do {
            let bridgeState = try await fetchBridgeManagedStatusSnapshot()
            applyBridgePackageStatus(
                from: bridgeState.payload,
                allowMissingVersionPrompt: bridgeState.allowMissingVersionPrompt,
                allowAvailableBridgeUpdatePrompt: allowAvailableBridgeUpdatePrompt
            )
        } catch {
            // Keep the last-known bridge version info when the status read fails transiently.
        }
    }

    // Starts a ChatGPT login or reuses the last valid auth URL while login is still pending.
    func startOrResumeGPTLogin() async throws -> ConstellagentGPTLoginStartResult {
        if let pendingLogin = currentPendingGPTLogin(),
           let authURL = URL(string: pendingLogin.authURL) {
            applyGPTAccountSnapshot(
                pendingLoginSnapshot(
                    expiresAt: pendingLogin.expiresAt,
                    retaining: gptAccountSnapshot
                )
            )
            gptAccountErrorMessage = nil
            return ConstellagentGPTLoginStartResult(
                loginId: pendingLogin.loginId,
                authURL: authURL,
                expiresAt: pendingLogin.expiresAt
            )
        }

        guard isConnected else {
            throw ConstellagentServiceError.disconnected
        }

        let response = try await sendRequest(
            method: "account/login/start",
            params: .object([
                "type": .string("chatgpt"),
            ])
        )
        let loginStartResult = try decodeGPTLoginStartResult(from: response)
        gptPendingLoginState = ConstellagentGPTLoginState(
            loginId: loginStartResult.loginId,
            authURL: loginStartResult.authURL.absoluteString,
            createdAt: .now,
            expiresAt: loginStartResult.expiresAt
        )
        applyGPTAccountSnapshot(
            pendingLoginSnapshot(
                expiresAt: loginStartResult.expiresAt,
                retaining: gptAccountSnapshot
            )
        )
        gptAccountErrorMessage = nil
        return loginStartResult
    }

    // Starts or resumes ChatGPT login, then asks the bridge Mac to open the browser locally.
    func startOrResumeGPTLoginOnMac() async throws {
        guard isConnected else {
            throw ConstellagentServiceError.disconnected
        }

        let login = try await startOrResumeGPTLogin()
        try await openGPTLoginOnMac(authURL: login.authURL)
        startGPTLoginSyncIfNeeded()
    }

    // Starts or resumes ChatGPT login and returns the auth URL so iPhone can open it directly.
    func startOrResumeGPTLoginOnPhone() async throws -> URL {
        guard isConnected else {
            throw ConstellagentServiceError.disconnected
        }

        let login = try await startOrResumeGPTLogin()
        startGPTLoginSyncIfNeeded()
        return login.authURL
    }

    // Cancels a pending browser login locally and on the Mac runtime when reachable.
    func cancelGPTLogin() async {
        if isConnected, let pendingLogin = currentPendingGPTLogin() {
            _ = try? await sendRequest(
                method: "account/login/cancel",
                params: .object([
                    "loginId": .string(pendingLogin.loginId),
                ])
            )
        }

        clearGPTLoginState()
        clearGPTLoginCallbackState()
        stopGPTLoginSync()
        if !gptAccountSnapshot.isAuthenticated {
            applyGPTAccountSnapshot(loggedOutGPTAccountSnapshot(status: .notLoggedIn, retaining: gptAccountSnapshot))
        }
        gptAccountErrorMessage = nil
    }

    // Logs the Mac-owned ChatGPT session out without touching pairing or reconnect state.
    func logoutGPTAccount() async {
        if isConnected {
            _ = try? await sendRequest(method: "account/logout", params: nil)
        }

        clearGPTLoginState()
        clearGPTLoginCallbackState()
        stopGPTLoginSync()
        applyGPTAccountSnapshot(loggedOutGPTAccountSnapshot(
            status: .notLoggedIn,
            retaining: constellagentGPTAccountInitialSnapshot()
        ))
        gptAccountErrorMessage = nil
    }

    // Keeps the account card honest when voice auth proves the bridge auth is no longer usable.
    func markGPTVoiceReauthenticationRequired() {
        stopGPTLoginSync()
        clearGPTLoginState()
        clearGPTLoginCallbackState()
        applyGPTAccountSnapshot(
            loggedOutGPTAccountSnapshot(
                status: .expired,
                needsReauth: true,
                retaining: gptAccountSnapshot
            )
        )
        gptAccountErrorMessage = "Voice mode needs fresh OpenAI auth on your paired device."
    }

    // Stores an incoming deep-link callback and completes the pending login when the bridge is reachable.
    func handleGPTLoginCallbackURL(_ url: URL) async {
        guard isExpectedGPTLoginCallbackURL(url) else {
            return
        }

        guard let pendingLogin = currentPendingGPTLogin() else {
            return
        }

        let callbackState = ConstellagentGPTLoginCallbackState(
            loginId: pendingLogin.loginId,
            callbackURL: url.absoluteString,
            createdAt: .now
        )
        gptPendingLoginCallbackState = callbackState
        await resumePendingGPTLoginIfPossible()
    }

    // Retries a stored callback after reconnects so a completed browser login is not lost.
    func resumePendingGPTLoginIfPossible() async {
        guard isConnected,
              let pendingLogin = currentPendingGPTLogin(),
              let callbackState = currentPendingGPTLoginCallback(),
              callbackState.loginId == pendingLogin.loginId else {
            return
        }

        do {
            _ = try await sendRequest(
                method: "account/login/complete",
                params: .object([
                    "loginId": .string(callbackState.loginId),
                    "callbackUrl": .string(callbackState.callbackURL),
                ])
            )
            clearGPTLoginCallbackState()
            gptAccountErrorMessage = nil
            startGPTLoginSyncIfNeeded()
        } catch {
            gptAccountErrorMessage = error.localizedDescription
        }
    }

    // Reacts to the provider login finishing on the Mac and refreshes the safe snapshot on iPhone.
    func handleGPTLoginCompletedNotification(_ paramsObject: IncomingParamsObject?) {
        let notificationLoginID = firstStringValue(in: paramsObject, keys: ["loginId", "login_id"])
        if let pendingLogin = currentPendingGPTLogin(),
           let notificationLoginID,
           notificationLoginID != pendingLogin.loginId {
            return
        }

        let wasSuccessful = firstBoolValue(in: paramsObject, keys: ["success"]) ?? false
        if wasSuccessful {
            clearGPTLoginCallbackState()
            gptAccountErrorMessage = nil
            startGPTLoginSyncIfNeeded()
            Task { await refreshGPTAccountState() }
            return
        }

        clearGPTLoginState()
        clearGPTLoginCallbackState()
        stopGPTLoginSync()
        gptAccountErrorMessage = firstStringValue(in: paramsObject, keys: ["error", "message"])
            ?? "ChatGPT sign-in did not complete."
        if !gptAccountSnapshot.isAuthenticated {
            applyGPTAccountSnapshot(
                loggedOutGPTAccountSnapshot(
                    status: .expired,
                    needsReauth: true,
                    retaining: gptAccountSnapshot
                )
            )
        }
    }

    // Keeps the cached snapshot in sync with logout and plan-change notifications from the bridge runtime.
    func handleGPTAccountUpdated(_ paramsObject: IncomingParamsObject?) {
        if let planType = firstStringValue(in: paramsObject, keys: ["planType", "plan_type"]) {
            gptAccountSnapshot.planType = planType
            gptAccountSnapshot.updatedAt = .now
        }

        Task { await refreshGPTAccountState() }
    }

    // Falls back to the last known safe snapshot so reconnects do not look like unexpected logouts.
    func applyGPTAccountConnectionFallback() {
        if let pendingLogin = currentPendingGPTLogin() {
            applyGPTAccountSnapshot(
                pendingLoginSnapshot(
                    expiresAt: pendingLogin.expiresAt,
                    retaining: gptAccountSnapshot
                )
            )
            return
        }

        if gptAccountSnapshot.status == .unknown {
            gptAccountSnapshot = disconnectedGPTAccountSnapshot()
        }
    }

    // Determines whether the mic button should nudge the user into login instead of recording.
    var gptVoiceRequiresLogin: Bool {
        !gptAccountSnapshot.isAuthenticated || gptAccountSnapshot.hasActiveLogin
    }

    // Separates signed-in state from bridge token readiness so the mic does not appear ready too early.
    var gptVoiceTemporarilyUnavailable: Bool {
        isConnected
            && gptAccountSnapshot.isAuthenticated
            && !gptAccountSnapshot.hasActiveLogin
            && !gptAccountSnapshot.isVoiceTokenReady
    }

    // Determines whether the bridge-backed voice flow can capture and transcribe audio right now.
    var canUseGPTVoiceTranscription: Bool {
        isConnected && gptAccountSnapshot.isAuthenticated && gptAccountSnapshot.isVoiceTokenReady && !gptAccountSnapshot.hasActiveLogin
    }

    // Re-polls account status while the user is finishing login in the browser.
    func startGPTLoginSyncIfNeeded() {
        guard gptAccountLoginSyncTask == nil, currentPendingGPTLogin() != nil else {
            return
        }

        gptAccountLoginSyncTask = Task { @MainActor [weak self] in
            while let self, !Task.isCancelled {
                guard self.currentPendingGPTLogin() != nil else {
                    self.stopGPTLoginSync()
                    return
                }

                if self.isConnected {
                    await self.refreshGPTAccountState()
                }

                if self.gptAccountSnapshot.status == .expired
                    || (self.gptAccountSnapshot.isAuthenticated && self.gptAccountSnapshot.isVoiceTokenReady)
                    || self.currentPendingGPTLogin() == nil {
                    self.stopGPTLoginSync()
                    return
                }

                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    // Stops the lightweight login polling once the bridge reports a stable account state.
    func stopGPTLoginSync() {
        gptAccountLoginSyncTask?.cancel()
        gptAccountLoginSyncTask = nil
    }
}

// Split-file storage helpers stay service-internal so ConstellagentService.swift can restore/persist GPT auth state.
extension ConstellagentService {
    static let gptAccountSnapshotDefaultsKey = "constellagent.gpt.accountSnapshot"
    static let gptPendingLoginStateDefaultsKey = "constellagent.gpt.pendingLoginState"
    static let gptPendingLoginCallbackDefaultsKey = "constellagent.gpt.pendingLoginCallbackState"

    var gptPendingLoginState: ConstellagentGPTLoginState? {
        get { gptPendingLoginState(macDeviceId: normalizedCurrentTrustedMacDeviceId) }
        set { setGPTPendingLoginState(newValue, macDeviceId: normalizedCurrentTrustedMacDeviceId) }
    }

    func gptPendingLoginState(macDeviceId: String?) -> ConstellagentGPTLoginState? {
        guard let data = defaults.data(forKey: macScopedDefaultsKey(Self.gptPendingLoginStateDefaultsKey, macDeviceId: macDeviceId)),
              let state = try? decoder.decode(ConstellagentGPTLoginState.self, from: data) else {
            return nil
        }

        return state.isExpired ? nil : state
    }

    func setGPTPendingLoginState(_ newValue: ConstellagentGPTLoginState?, macDeviceId: String?) {
        if let newValue {
            guard let data = try? encoder.encode(newValue) else {
                return
            }
            defaults.set(data, forKey: macScopedDefaultsKey(Self.gptPendingLoginStateDefaultsKey, macDeviceId: macDeviceId))
        } else {
            defaults.removeObject(forKey: macScopedDefaultsKey(Self.gptPendingLoginStateDefaultsKey, macDeviceId: macDeviceId))
        }
    }

    var gptPendingLoginCallbackState: ConstellagentGPTLoginCallbackState? {
        get { gptPendingLoginCallbackState(macDeviceId: normalizedCurrentTrustedMacDeviceId) }
        set { setGPTPendingLoginCallbackState(newValue, macDeviceId: normalizedCurrentTrustedMacDeviceId) }
    }

    func gptPendingLoginCallbackState(macDeviceId: String?) -> ConstellagentGPTLoginCallbackState? {
        guard let data = defaults.data(forKey: macScopedDefaultsKey(Self.gptPendingLoginCallbackDefaultsKey, macDeviceId: macDeviceId)),
              let state = try? decoder.decode(ConstellagentGPTLoginCallbackState.self, from: data) else {
            return nil
        }

        return state.isExpired ? nil : state
    }

    func setGPTPendingLoginCallbackState(_ newValue: ConstellagentGPTLoginCallbackState?, macDeviceId: String?) {
        if let newValue {
            guard let data = try? encoder.encode(newValue) else {
                return
            }
            defaults.set(data, forKey: macScopedDefaultsKey(Self.gptPendingLoginCallbackDefaultsKey, macDeviceId: macDeviceId))
        } else {
            defaults.removeObject(forKey: macScopedDefaultsKey(Self.gptPendingLoginCallbackDefaultsKey, macDeviceId: macDeviceId))
        }
    }

    func currentPendingGPTLogin() -> ConstellagentGPTLoginState? {
        guard let pendingLogin = gptPendingLoginState else {
            return nil
        }

        if pendingLogin.isExpired {
            clearGPTLoginState()
            return nil
        }

        return pendingLogin
    }

    func currentPendingGPTLoginCallback() -> ConstellagentGPTLoginCallbackState? {
        guard let callbackState = gptPendingLoginCallbackState else {
            return nil
        }

        if callbackState.isExpired {
            clearGPTLoginCallbackState()
            return nil
        }

        return callbackState
    }

    func loadPersistedGPTAccountSnapshot(macDeviceId: String? = nil) -> ConstellagentGPTAccountSnapshot? {
        guard let data = defaults.data(forKey: macScopedDefaultsKey(Self.gptAccountSnapshotDefaultsKey, macDeviceId: macDeviceId)),
              let snapshot = try? decoder.decode(ConstellagentGPTAccountSnapshot.self, from: data) else {
            return nil
        }
        return snapshot
    }

    func persistGPTAccountSnapshot(_ snapshot: ConstellagentGPTAccountSnapshot, macDeviceId: String? = nil) {
        guard !suspendAutomaticMacScopedPersistence, !isApplyingMacScopedState else {
            return
        }

        guard let data = try? encoder.encode(snapshot) else {
            return
        }
        defaults.set(data, forKey: macScopedDefaultsKey(Self.gptAccountSnapshotDefaultsKey, macDeviceId: macDeviceId))
    }

    func clearGPTLoginState() {
        gptPendingLoginState = nil
        stopGPTLoginSync()
    }

    func clearGPTLoginCallbackState() {
        gptPendingLoginCallbackState = nil
    }

    // Keeps stale browser URLs from surviving once the runtime reports a stable account state.
    func syncPendingGPTLoginStateIfNeeded() {
        guard let pendingLogin = gptPendingLoginState else {
            clearGPTLoginCallbackState()
            return
        }

        if pendingLogin.isExpired
            || (gptAccountSnapshot.isAuthenticated && gptAccountSnapshot.isVoiceTokenReady)
            || gptAccountSnapshot.status == .expired {
            clearGPTLoginState()
            clearGPTLoginCallbackState()
            return
        }

        if let callbackState = currentPendingGPTLoginCallback(),
           callbackState.loginId != pendingLogin.loginId {
            clearGPTLoginCallbackState()
        }
    }

    // Centralizes snapshot writes so persistence and pending-login cleanup stay aligned.
    func applyGPTAccountSnapshot(_ snapshot: ConstellagentGPTAccountSnapshot) {
        var resolvedSnapshot = snapshot
        if resolvedSnapshot.status == .authenticated || resolvedSnapshot.status == .expired {
            resolvedSnapshot.loginInFlight = false
        }
        if (resolvedSnapshot.isAuthenticated && resolvedSnapshot.isVoiceTokenReady)
            || resolvedSnapshot.status == .expired {
            clearGPTLoginState()
            clearGPTLoginCallbackState()
        }
        resolvedSnapshot.updatedAt = .now
        gptAccountSnapshot = resolvedSnapshot
        syncPendingGPTLoginStateIfNeeded()
    }

    private func fetchBridgeManagedStatusSnapshot() async throws -> (
        payload: IncomingParamsObject,
        allowMissingVersionPrompt: Bool
    ) {
        do {
            let response = try await sendRequest(method: "account/status/read", params: nil)
            guard let payload = response.result?.objectValue else {
                throw ConstellagentServiceError.invalidResponse("bridge account status response missing payload")
            }
            return (
                payload: payload,
                allowMissingVersionPrompt: true
            )
        } catch {
            let response = try await sendRequest(method: "getAuthStatus", params: nil)
            guard let payload = response.result?.objectValue else {
                throw ConstellagentServiceError.invalidResponse("bridge account status response missing payload")
            }
            return (
                payload: payload,
                allowMissingVersionPrompt: shouldTreatAsUnsupportedBridgeManagedAccountStatus(error)
            )
        }
    }

    // Applies the bridge-owned ChatGPT snapshot after a shared managed-status fetch.
    private func applyBridgeManagedAccountSnapshot(from payloadObject: IncomingParamsObject) {
        applyGPTAccountSnapshot(decodeBridgeGPTAccountSnapshot(from: payloadObject))
        if currentPendingGPTLogin() != nil,
           (gptAccountSnapshot.hasActiveLogin || (gptAccountSnapshot.isAuthenticated && !gptAccountSnapshot.isVoiceTokenReady)) {
            startGPTLoginSyncIfNeeded()
        }
        if gptAccountSnapshot.isAuthenticated || gptAccountSnapshot.status == .notLoggedIn {
            gptAccountErrorMessage = nil
        }
    }

    // Applies bridge package versions and prompts independently from GPT account state.
    private func applyBridgePackageStatus(
        from payloadObject: IncomingParamsObject,
        allowMissingVersionPrompt: Bool,
        allowAvailableBridgeUpdatePrompt: Bool
    ) {
        let previousTransportMode = constellagentTransportMode
        constellagentTransportMode = decodeConstellagentTransportMode(
            from: firstStringValue(
                in: payloadObject,
                keys: ["constellagentTransportMode", "constellagent_transport_mode", "transportMode", "transport_mode"]
            )
        )
        reconcileNativePlanSessionSources(
            previousTransportMode: previousTransportMode,
            nextTransportMode: constellagentTransportMode
        )
        bridgeInstalledVersion = firstStringValue(
            in: payloadObject,
            keys: ["bridgeVersion", "bridge_version", "bridgePackageVersion", "bridge_package_version"]
        )
        latestBridgePackageVersion = firstStringValue(
            in: payloadObject,
            keys: ["bridgeLatestVersion", "bridge_latest_version", "bridgePublishedVersion", "bridge_published_version"]
        )
        applyBridgeHostMetadata(from: payloadObject)
        evaluateRequiredBridgePackageVersion(
            from: payloadObject,
            allowMissingVersionPrompt: allowMissingVersionPrompt
        )
        if allowAvailableBridgeUpdatePrompt {
            evaluateAvailableBridgePackageVersionPromptIfNeeded()
        }
    }

    private func decodeConstellagentTransportMode(from rawValue: String?) -> ConstellagentRuntimeTransportMode {
        guard let rawValue = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !rawValue.isEmpty else {
            return .unknown
        }

        return ConstellagentRuntimeTransportMode(rawValue: rawValue) ?? .unknown
    }

    private func applyBridgeHostMetadata(from payloadObject: IncomingParamsObject) {
        gptAccountSnapshot.hostPlatform = decodeBridgeHostPlatform(
            from: firstStringValue(
                in: payloadObject,
                keys: ["hostPlatform", "host_platform", "bridgeHostPlatform", "bridge_host_platform"]
            )
        )
        gptAccountSnapshot.hostCapabilities = decodeBridgeHostCapabilities(from: payloadObject)
    }

    private func handleBridgeManagedAccountRefreshFailure() {
        if gptAccountSnapshot.status == .unknown {
            gptAccountSnapshot = disconnectedGPTAccountSnapshot()
        }
    }

    // Prompts for a bridge package upgrade once per session when bridge-managed status
    // reports an older npm package or omits the version entirely.
    private func evaluateRequiredBridgePackageVersion(
        from payloadObject: IncomingParamsObject,
        allowMissingVersionPrompt: Bool
    ) {
        guard !hasPresentedMinimumBridgePackageUpdatePrompt else {
            return
        }

        let bridgeVersion = firstStringValue(
            in: payloadObject,
            keys: ["bridgeVersion", "bridge_version", "bridgePackageVersion", "bridge_package_version"]
        )
        let requiresUpgrade =
            bridgePackageVersionIsOlderThanMinimum(bridgeVersion)
            || (bridgeVersion == nil && allowMissingVersionPrompt)

        guard requiresUpgrade else {
            return
        }

        hasPresentedMinimumBridgePackageUpdatePrompt = true
        bridgeUpdatePrompt = minimumBridgePackageUpdatePrompt(currentVersion: bridgeVersion)
    }

    // Only explicit versions can be compared here; missing versions are handled by the caller.
    private func bridgePackageVersionIsOlderThanMinimum(_ bridgeVersion: String?) -> Bool {
        guard let bridgeVersion = bridgeVersion?.trimmingCharacters(in: .whitespacesAndNewlines),
              !bridgeVersion.isEmpty else {
            return false
        }

        return bridgeVersion.compare(ConstellagentService.minimumSupportedBridgePackageVersion, options: .numeric) == .orderedAscending
    }

    // Distinguishes "older bridge only exposes getAuthStatus" from transient read failures on a current bridge.
    private func shouldTreatAsUnsupportedBridgeManagedAccountStatus(_ error: Error) -> Bool {
        guard let serviceError = error as? ConstellagentServiceError,
              case .rpcError(let rpcError) = serviceError else {
            return false
        }

        if rpcError.code == -32601 {
            return true
        }

        let message = rpcError.message.lowercased()
        let mentionsUnsupportedMethod = message.contains("method not found")
            || message.contains("unknown method")
            || message.contains("not implemented")
            || message.contains("does not support")
        let mentionsAccountStatusRoute = message.contains("account/status/read")
            || message.contains("account status read")
            || message.contains("auth status")

        guard rpcError.code == -32600 || rpcError.code == -32602 || rpcError.code == -32000 else {
            return mentionsUnsupportedMethod && mentionsAccountStatusRoute
        }

        return mentionsUnsupportedMethod && mentionsAccountStatusRoute
    }

    private func minimumBridgePackageUpdatePrompt(currentVersion: String?) -> ConstellagentBridgeUpdatePrompt {
        let message: String
        if let currentVersion = currentVersion?.trimmingCharacters(in: .whitespacesAndNewlines),
           !currentVersion.isEmpty {
            message =
                "This device bridge is running Constellagent \(currentVersion), but this iPhone app requires Constellagent \(ConstellagentService.minimumSupportedBridgePackageVersion) or newer. Update the npm package on your device, then reconnect."
        } else {
            message =
                "This device bridge is too old for this version of Constellagent iPhone. Update the Constellagent npm package on your device to \(ConstellagentService.minimumSupportedBridgePackageVersion) or newer, then reconnect."
        }

        return ConstellagentBridgeUpdatePrompt(
            title: "Update Constellagent on your device to reconnect",
            message: message,
            command: minimumBridgePackageUpdateCommand
        )
    }

    // Surfaces a softer "npm update available" prompt without overriding stricter compatibility prompts.
    private func evaluateAvailableBridgePackageVersionPromptIfNeeded() {
        guard isAppInForeground else {
            return
        }

        guard bridgeUpdatePrompt == nil else {
            return
        }

        guard let installedVersion = normalizedBridgePackageVersion(bridgeInstalledVersion) else {
            return
        }

        if installedVersion == forcedBridgeUpgradeFromVersion {
            guard lastPresentedAvailableBridgePackageVersion != forcedBridgeUpgradeTargetVersion else {
                return
            }

            lastPresentedAvailableBridgePackageVersion = forcedBridgeUpgradeTargetVersion
            bridgeUpdatePrompt = forcedBridgePackageUpdatePrompt(currentVersion: installedVersion)
            return
        }

        guard let latestVersion = normalizedBridgePackageVersion(latestBridgePackageVersion),
              installedVersion.compare(latestVersion, options: .numeric) == .orderedAscending else {
            return
        }

        guard lastPresentedAvailableBridgePackageVersion != latestVersion else {
            return
        }

        lastPresentedAvailableBridgePackageVersion = latestVersion
        bridgeUpdatePrompt = availableBridgePackageUpdatePrompt(
            currentVersion: installedVersion,
            latestVersion: latestVersion
        )
    }

    // Keeps version comparisons and prompt copy on one normalized representation.
    private func normalizedBridgePackageVersion(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }

        return trimmed
    }

    private func availableBridgePackageUpdatePrompt(
        currentVersion: String,
        latestVersion: String
    ) -> ConstellagentBridgeUpdatePrompt {
        ConstellagentBridgeUpdatePrompt(
            title: "A newer Constellagent update is available on your device",
            message: "This device bridge is running Constellagent \(currentVersion), and npm now has Constellagent \(latestVersion). Update the package on your device when you're ready, then reconnect to start using the newer build.",
            command: minimumBridgePackageUpdateCommand
        )
    }

    private func forcedBridgePackageUpdatePrompt(currentVersion: String) -> ConstellagentBridgeUpdatePrompt {
        ConstellagentBridgeUpdatePrompt(
            title: "Update Constellagent on your device to reconnect",
            message: "This device bridge is running Constellagent \(currentVersion). Update the Constellagent CLI on your device to \(forcedBridgeUpgradeTargetVersion), then reconnect.",
            command: forcedBridgeUpgradeCommand
        )
    }

    // Opens the pending ChatGPT login URL on the bridge Mac instead of opening Safari on iPhone.
    func openGPTLoginOnMac(authURL: URL) async throws {
        _ = try await sendRequest(
            method: "account/login/openOnMac",
            params: .object([
                "authUrl": .string(authURL.absoluteString),
            ])
        )
    }

    func isExpectedGPTLoginCallbackURL(_ url: URL) -> Bool {
        guard let callbackScheme = Bundle.main.object(
            forInfoDictionaryKey: "PHODEX_CHATGPT_CALLBACK_SCHEME"
        ) as? String else {
            return false
        }

        guard url.scheme?.caseInsensitiveCompare(callbackScheme) == .orderedSame else {
            return false
        }

        return url.host == "auth" && url.path.lowercased().contains("/gpt/callback")
    }

    func decodeBridgeGPTAccountSnapshot(from payloadObject: IncomingParamsObject) -> ConstellagentGPTAccountSnapshot {
        // Older bridges fall back to raw `getAuthStatus`, so derive a stable account state
        // even when the payload does not include the newer sanitized `status` field.
        let parsedStatus = decodeGPTAccountStatus(
            from: firstStringValue(in: payloadObject, keys: ["status", "state"])
        )
        let bridgeReportedPendingLogin = firstBoolValue(in: payloadObject, keys: ["loginInFlight", "login_in_flight"]) ?? false
        let needsReauth = firstBoolValue(in: payloadObject, keys: ["needsReauth", "needs_reauth"]) ?? false
        let legacyAuthMethod = decodeGPTAuthMethod(
            from: firstStringValue(in: payloadObject, keys: ["authMethod", "auth_mode"])
        )
        let hasLegacyAuthToken = firstStringValue(in: payloadObject, keys: ["authToken", "auth_token"]) != nil

        let resolvedStatus: ConstellagentGPTAccountStatus
        if parsedStatus == .authenticated || parsedStatus == .expired {
            resolvedStatus = parsedStatus
        } else if parsedStatus == .unknown && hasLegacyAuthToken && legacyAuthMethod != nil && !needsReauth {
            resolvedStatus = .authenticated
        } else if parsedStatus == .notLoggedIn && bridgeReportedPendingLogin && !needsReauth {
            resolvedStatus = .loginPending
        } else if parsedStatus == .unknown && bridgeReportedPendingLogin {
            resolvedStatus = .loginPending
        } else if parsedStatus == .unknown {
            resolvedStatus = .notLoggedIn
        } else {
            resolvedStatus = parsedStatus
        }

        let hasPendingLogin = bridgeReportedPendingLogin
            || (currentPendingGPTLogin() != nil && resolvedStatus != .authenticated && resolvedStatus != .expired)

        let tokenReady = resolvedTokenReady(
            from: payloadObject,
            status: resolvedStatus,
            needsReauth: needsReauth,
            hasLegacyAuthToken: hasLegacyAuthToken
        )
        let tokenUnavailableSince = resolvedTokenUnavailableSince(
            status: resolvedStatus,
            needsReauth: needsReauth,
            tokenReady: tokenReady
        )
        let escalatedNeedsReauth = resolvedNeedsReauth(
            baseNeedsReauth: needsReauth,
            status: resolvedStatus,
            tokenReady: tokenReady,
            tokenUnavailableSince: tokenUnavailableSince
        )

        return ConstellagentGPTAccountSnapshot(
            status: resolvedStatus,
            authMethod: legacyAuthMethod,
            email: firstStringValue(in: payloadObject, keys: ["email"]),
            displayName: nil,
            planType: firstStringValue(in: payloadObject, keys: ["planType", "plan_type"]),
            hostPlatform: decodeBridgeHostPlatform(
                from: firstStringValue(
                    in: payloadObject,
                    keys: ["hostPlatform", "host_platform", "bridgeHostPlatform", "bridge_host_platform"]
                )
            ),
            hostCapabilities: decodeBridgeHostCapabilities(from: payloadObject),
            loginInFlight: hasPendingLogin,
            needsReauth: escalatedNeedsReauth,
            expiresAt: firstDateValue(in: payloadObject, keys: ["expiresAt", "expires_at"]),
            tokenReady: tokenReady,
            tokenUnavailableSince: tokenUnavailableSince,
            updatedAt: .now
        )
    }

    func decodeGPTLoginStartResult(from response: RPCMessage) throws -> ConstellagentGPTLoginStartResult {
        guard let payloadObject = response.result?.objectValue else {
            throw ConstellagentServiceError.invalidResponse("account/login/start response missing payload")
        }

        guard firstStringValue(in: payloadObject, keys: ["type"]) == "chatgpt" else {
            throw ConstellagentServiceError.invalidResponse("account/login/start did not return a ChatGPT login flow")
        }

        guard let loginId = firstStringValue(in: payloadObject, keys: ["loginId", "login_id"]),
              let authURLString = firstStringValue(in: payloadObject, keys: ["authUrl", "auth_url"]),
              let authURL = URL(string: authURLString) else {
            throw ConstellagentServiceError.invalidResponse("account/login/start response missing auth URL")
        }

        return ConstellagentGPTLoginStartResult(
            loginId: loginId,
            authURL: authURL,
            expiresAt: firstDateValue(in: payloadObject, keys: ["expiresAt", "expires_at"])
        )
    }

    func disconnectedGPTAccountSnapshot() -> ConstellagentGPTAccountSnapshot {
        ConstellagentGPTAccountSnapshot(
            status: .unavailable,
            authMethod: gptAccountSnapshot.authMethod,
            email: gptAccountSnapshot.email,
            displayName: gptAccountSnapshot.displayName,
            planType: gptAccountSnapshot.planType,
            hostPlatform: gptAccountSnapshot.hostPlatform,
            hostCapabilities: gptAccountSnapshot.hostCapabilities,
            loginInFlight: currentPendingGPTLogin() != nil,
            needsReauth: false,
            expiresAt: currentPendingGPTLogin()?.expiresAt,
            tokenReady: gptAccountSnapshot.tokenReady,
            tokenUnavailableSince: gptAccountSnapshot.tokenUnavailableSince,
            updatedAt: .now
        )
    }

    func pendingLoginSnapshot(
        expiresAt: Date?,
        retaining snapshot: ConstellagentGPTAccountSnapshot
    ) -> ConstellagentGPTAccountSnapshot {
        ConstellagentGPTAccountSnapshot(
            status: .loginPending,
            authMethod: .chatgpt,
            email: snapshot.email,
            displayName: snapshot.displayName,
            planType: snapshot.planType,
            hostPlatform: snapshot.hostPlatform,
            hostCapabilities: snapshot.hostCapabilities,
            loginInFlight: true,
            needsReauth: false,
            expiresAt: expiresAt,
            tokenReady: false,
            tokenUnavailableSince: nil,
            updatedAt: .now
        )
    }

    func loggedOutGPTAccountSnapshot(
        status: ConstellagentGPTAccountStatus,
        needsReauth: Bool = false,
        retaining snapshot: ConstellagentGPTAccountSnapshot
    ) -> ConstellagentGPTAccountSnapshot {
        ConstellagentGPTAccountSnapshot(
            status: status,
            authMethod: nil,
            email: needsReauth ? snapshot.email : nil,
            displayName: needsReauth ? snapshot.displayName : nil,
            planType: needsReauth ? snapshot.planType : nil,
            hostPlatform: snapshot.hostPlatform,
            hostCapabilities: snapshot.hostCapabilities,
            loginInFlight: false,
            needsReauth: needsReauth,
            expiresAt: nil,
            tokenReady: false,
            tokenUnavailableSince: nil,
            updatedAt: .now
        )
    }

    func resolvedTokenReady(
        from payloadObject: IncomingParamsObject,
        status: ConstellagentGPTAccountStatus,
        needsReauth: Bool,
        hasLegacyAuthToken: Bool = false
    ) -> Bool {
        if let tokenReady = firstBoolValue(in: payloadObject, keys: ["tokenReady", "token_ready"]) {
            return tokenReady
        }

        return hasLegacyAuthToken && status == .authenticated && !needsReauth
    }

    func resolvedTokenUnavailableSince(
        status: ConstellagentGPTAccountStatus,
        needsReauth: Bool,
        tokenReady: Bool
    ) -> Date? {
        guard status == .authenticated, !needsReauth, !tokenReady else {
            return nil
        }

        if gptAccountSnapshot.status == .authenticated,
           gptAccountSnapshot.tokenReady == false,
           let existingDate = gptAccountSnapshot.tokenUnavailableSince {
            return existingDate
        }

        return .now
    }

    func resolvedNeedsReauth(
        baseNeedsReauth: Bool,
        status: ConstellagentGPTAccountStatus,
        tokenReady: Bool,
        tokenUnavailableSince: Date?
    ) -> Bool {
        guard !baseNeedsReauth else {
            return true
        }

        if gptAccountSnapshot.needsReauth, !tokenReady {
            return true
        }

        guard status == .authenticated, !tokenReady, let tokenUnavailableSince else {
            return false
        }

        return Date().timeIntervalSince(tokenUnavailableSince) >= ConstellagentGPTAccountSnapshot.voiceTokenGraceInterval
    }

    func decodeGPTAccountStatus(from value: String?) -> ConstellagentGPTAccountStatus {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() else {
            return .unknown
        }

        switch value {
        case "authenticated", "logged_in", "loggedin", "connected":
            return .authenticated
        case "loginpending", "login_pending", "pending", "pending_login":
            return .loginPending
        case "expired", "needs_reauth", "needsreauth", "reauth_required":
            return .expired
        case "not_logged_in", "notloggedin", "signed_out", "logged_out", "unauthenticated":
            return .notLoggedIn
        case "unavailable", "offline":
            return .unavailable
        default:
            return .unknown
        }
    }

    func decodeGPTAuthMethod(from value: String?) -> ConstellagentGPTAuthMethod? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !value.isEmpty else {
            return nil
        }

        switch value {
        case "chatgpt", "chat_gpt", "chatgptauthtokens":
            return .chatgpt
        default:
            return nil
        }
    }

    func decodeBridgeHostPlatform(from value: String?) -> ConstellagentBridgeHostPlatform? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !value.isEmpty else {
            return nil
        }

        return ConstellagentBridgeHostPlatform(rawValue: value) ?? .unknown
    }

    func decodeBridgeHostCapabilities(from payloadObject: IncomingParamsObject) -> ConstellagentBridgeHostCapabilities? {
        let capabilitiesObject = payloadObject["hostCapabilities"]?.objectValue
            ?? payloadObject["host_capabilities"]?.objectValue
            ?? payloadObject["bridgeHostCapabilities"]?.objectValue
            ?? payloadObject["bridge_host_capabilities"]?.objectValue

        guard let capabilitiesObject else {
            return nil
        }

        return ConstellagentBridgeHostCapabilities(
            desktopHandoff: firstBoolValue(in: capabilitiesObject, keys: ["desktopHandoff", "desktop_handoff"]) ?? false,
            displayWake: firstBoolValue(in: capabilitiesObject, keys: ["displayWake", "display_wake"]) ?? false,
            keepAwake: firstBoolValue(in: capabilitiesObject, keys: ["keepAwake", "keep_awake"]) ?? false,
            hostBrowserLogin: firstBoolValue(in: capabilitiesObject, keys: ["hostBrowserLogin", "host_browser_login"]) ?? false,
            terminal: firstBoolValue(in: capabilitiesObject, keys: ["terminal", "sshTerminal", "ssh_terminal"]) ?? false,
            bridgeUpdate: firstBoolValue(in: capabilitiesObject, keys: ["bridgeUpdate", "bridge_update"]) ?? false
        )
    }

    func firstStringValue(in object: IncomingParamsObject?, keys: [String]) -> String? {
        guard let object else {
            return nil
        }

        for key in keys {
            if let value = object[key]?.stringValue {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
        }
        return nil
    }

    func firstBoolValue(in object: IncomingParamsObject?, keys: [String]) -> Bool? {
        guard let object else {
            return nil
        }

        for key in keys {
            if let value = object[key]?.boolValue {
                return value
            }

            if let value = object[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
                switch value {
                case "true", "1", "yes", "y":
                    return true
                case "false", "0", "no", "n":
                    return false
                default:
                    continue
                }
            }

            if let value = object[key]?.intValue {
                return value != 0
            }
        }

        return nil
    }

    func firstDateValue(in object: IncomingParamsObject?, keys: [String]) -> Date? {
        guard let object else {
            return nil
        }

        for key in keys {
            if let value = object[key], let decodedDate = decodeDateValue(value) {
                return decodedDate
            }
        }
        return nil
    }

    func decodeDateValue(_ value: JSONValue) -> Date? {
        switch value {
        case .integer(let integer):
            let interval = integer > 10_000_000_000 ? TimeInterval(integer) / 1_000 : TimeInterval(integer)
            return Date(timeIntervalSince1970: interval)
        case .double(let double):
            let interval = double > 10_000_000_000 ? double / 1_000 : double
            return Date(timeIntervalSince1970: interval)
        case .string(let string):
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            if let interval = TimeInterval(trimmed) {
                let adjusted = interval > 10_000_000_000 ? interval / 1_000 : interval
                return Date(timeIntervalSince1970: adjusted)
            }

            let formatter = ISO8601DateFormatter()
            return formatter.date(from: trimmed)
        default:
            return nil
        }
    }
}

private extension ConstellagentGPTLoginState {
    var isExpired: Bool {
        guard let expiresAt else {
            return false
        }
        return expiresAt <= .now
    }
}

private extension ConstellagentGPTLoginCallbackState {
    var isExpired: Bool {
        createdAt.addingTimeInterval(10 * 60) <= .now
    }
}
