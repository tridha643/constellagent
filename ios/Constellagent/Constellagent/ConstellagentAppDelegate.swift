// FILE: ConstellagentAppDelegate.swift
// Purpose: Bridges APNs registration callbacks into the service layer without coupling SwiftUI views to UIApplicationDelegate.
// Layer: App
// Exports: ConstellagentAppDelegate, Notification.Name push-registration helpers
// Depends on: Foundation, UIKit

import Foundation
import UIKit

extension Notification.Name {
    static let constellagentDidRegisterForRemoteNotifications = Notification.Name("constellagent.didRegisterForRemoteNotifications")
    static let constellagentDidFailToRegisterForRemoteNotifications = Notification.Name("constellagent.didFailToRegisterForRemoteNotifications")
}

final class ConstellagentAppDelegate: NSObject, UIApplicationDelegate {
    // Forwards the APNs token so ConstellagentService can persist and sync it to the paired Mac bridge.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        NotificationCenter.default.post(
            name: .constellagentDidRegisterForRemoteNotifications,
            object: nil,
            userInfo: [
                "deviceToken": deviceToken,
            ]
        )
    }

    // Keeps registration failures observable in debug builds without surfacing noisy UI errors.
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        NotificationCenter.default.post(
            name: .constellagentDidFailToRegisterForRemoteNotifications,
            object: nil,
            userInfo: [
                "error": error,
            ]
        )
    }
}
