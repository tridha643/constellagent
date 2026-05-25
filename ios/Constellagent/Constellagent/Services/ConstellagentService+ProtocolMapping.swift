// Protocol mapping layer between the iOS client (shadow-cloned from
// remodex's CodexMobile/, which speaks the `codex app-server` JSON-RPC
// vocabulary: `thread/*`, `turn/*`, `account/*`, `model/list`, etc.) and
// the constellagent desktop bridge in
// `desktop/src/main/mobile-method-router.ts`, which speaks `session.*`,
// `workspace.*`, `git.*`, `plan.*`, `annotation.*`.
//
// Why a single mapper instead of editing every `Services/ConstellagentService+*.swift`:
// the iOS extensions are hundreds of call sites; the bridge router is the
// authoritative method set. Centralising the translation here means the
// per-extension code keeps reading like its remodex ancestor (easier to
// re-pull upstream fixes) while the wire actually matches constellagent.
//
// Unsupported methods return a stub `RPCMessage` with a structured error
// rather than throwing — many call sites tolerate empty results (account
// status, model list, collaboration mode list) and a hard throw would
// crash the UI before features that ARE wired up can be exercised.

import Foundation

enum ConstellagentBridgeMethodMapping {

    // Direct 1:1 method renames that go straight onto the wire.
    static func map(method: String) -> String {
        switch method {
        // Sessions (constellagent calls them sessions, codex calls them threads)
        case "thread/list":                return "session.list"
        case "thread/read":                return "session.history"
        case "thread/turns/list":          return "session.history"
        case "thread/start":               return "session.start"
        case "thread/resume":              return "session.resume"
        case "turn/start":                 return "session.reply"
        case "turn/steer":                 return "session.reply"

        // Workspaces
        case "workspace/read":             return "workspace.read"
        case "workspace/list":             return "workspace.list"

        // Git
        case "git/status":                 return "git.status"
        case "git/branch/list":            return "git.branch.list"
        case "git/branch/switch":          return "git.branch.switch"
        case "git/commit":                 return "git.commit"
        case "git/diff":                   return "git.diff"

        // Plan mode
        case "plan/approve":               return "plan.approve"
        case "plan/reject":                return "plan.reject"
        case "plan/set":                   return "session.set_plan"

        // Annotations (new in constellagent — no codex equivalent)
        case "annotation/list":            return "annotation.list"
        case "annotation/create":          return "annotation.create"
        case "annotation/resolve":         return "annotation.resolve"

        // Runtime catalog
        case "model/list":                 return "model.list"

        default:
            return method
        }
    }

    // Methods the constellagent bridge has no equivalent for — return a
    // synthesised empty response rather than hitting the wire. Update this
    // set as the bridge grows.
    static let stubbedMethods: Set<String> = [
        "initialize",
        "getAuthStatus",
        "account/status/read",
        "account/login/cancel",
        "account/login/complete",
        "account/logout",
        "collaborationMode/list",
        "review/start",
        "notifications/push/register",
        "thread/fork",
        "thread/name/set",
        "thread/contextWindow/read",
        "thread/generateTitle",
        "thread/compact/start",
    ]

    static func isStubbed(method: String) -> Bool {
        stubbedMethods.contains(method)
    }

    // Empty-shape response for stubbed methods. Each method gets a result
    // object the iOS decoder can chew through without crashing. Add cases
    // here as new stubs trip the decoder in QA.
    static func stubResponse(for method: String, requestID: JSONValue) -> RPCMessage {
        let result: JSONValue
        switch method {
        case "collaborationMode/list":
            result = .object(["modes": .array([])])
        case "account/status/read":
            // Desktop Electron bridge does not expose Codex `account/status/read` yet.
            // Report a compliant package version so iOS does not block reconnect with the
            // npm-bridge upgrade prompt (missing `bridgeVersion` triggers that path).
            result = .object([
                "status": .string("not_logged_in"),
                "bridgeVersion": .string(ConstellagentService.minimumSupportedBridgePackageVersion),
                "constellagentTransportMode": .string("websocket"),
                "hostPlatform": .string("macos"),
            ])
        case "getAuthStatus":
            result = .object([
                "status": .string("not_logged_in"),
                "bridgeVersion": .string(ConstellagentService.minimumSupportedBridgePackageVersion),
                "constellagentTransportMode": .string("websocket"),
                "hostPlatform": .string("macos"),
            ])
        case "thread/contextWindow/read":
            result = .object(["usage": .object([:])])
        case "thread/generateTitle":
            result = .object(["title": .string("")])
        case "notifications/push/register":
            result = .object(["registered": .bool(false)])
        default:
            result = .object([:])
        }
        return RPCMessage(
            id: requestID,
            result: result,
            includeJSONRPC: false
        )
    }

    static func adaptParams(
        codexMethod: String,
        params: JSONValue?,
        workspacePathHint: String?
    ) -> JSONValue? {
        switch codexMethod {
        case "model/list":
            var object = params?.objectValue ?? [:]
            if object["workspacePath"] == nil,
               let workspacePathHint,
               !workspacePathHint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                object["workspacePath"] = .string(workspacePathHint)
            }
            return .object(object)
        case "turn/steer":
            var object = params?.objectValue ?? [:]
            object["deliverAs"] = .string("steer")
            return .object(object)
        default:
            return params
        }
    }
}
