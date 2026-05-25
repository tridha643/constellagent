// FILE: ConstellagentService+ProjectFolders.swift
// Purpose: Mac-local project folder browsing RPCs used by the sidebar new-chat flow.
// Layer: Service Extension
// Exports: ConstellagentProjectLocation, ConstellagentProjectDirectoryEntry, ConstellagentProjectDirectoryListing, ConstellagentService project folder APIs
// Depends on: Foundation, JSONValue, RPC transport

import Foundation

struct ConstellagentProjectLocation: Identifiable, Equatable, Sendable {
    let id: String
    let label: String
    let path: String
}

struct ConstellagentProjectDirectoryEntry: Identifiable, Equatable, Sendable {
    var id: String { path }
    let name: String
    let path: String
    let isSymlink: Bool
}

struct ConstellagentProjectDirectoryListing: Equatable, Sendable {
    let path: String
    let parentPath: String?
    let entries: [ConstellagentProjectDirectoryEntry]
}

struct ConstellagentProjectlessChatRoots: Equatable, Sendable {
    let roots: [String]
    let constellagentHome: String?
    let documentedThreadsRoot: String?
    let desktopDocumentsRoot: String?
}

extension ConstellagentService {
    // Loads Mac-local shortcut folders through the bridge instead of the Constellagent runtime.
    func fetchProjectQuickLocations() async throws -> [ConstellagentProjectLocation] {
        let response = try await sendRequest(method: "project/quickLocations", params: .object([:]))
        guard let locations = response.result?.objectValue?["locations"]?.arrayValue else {
            throw ConstellagentServiceError.invalidResponse("project/quickLocations response missing locations")
        }

        return locations.compactMap(Self.decodeProjectLocation)
    }

    // Reads host-side Constellagent chat roots so projectless classification survives custom CODEX_HOME.
    func fetchProjectlessChatRoots() async throws -> ConstellagentProjectlessChatRoots {
        let response = try await sendRequest(method: "project/projectlessRoots", params: .object([:]))
        guard let object = response.result?.objectValue else {
            throw ConstellagentServiceError.invalidResponse("project/projectlessRoots response missing payload")
        }

        let roots = object["roots"]?.arrayValue?.compactMap(\.stringValue) ?? []
        return ConstellagentProjectlessChatRoots(
            roots: roots,
            constellagentHome: object["constellagentHome"]?.stringValue,
            documentedThreadsRoot: object["documentedThreadsRoot"]?.stringValue,
            desktopDocumentsRoot: object["desktopDocumentsRoot"]?.stringValue
        )
    }

    // Lists only child directories for the phone-side project picker.
    func listProjectDirectory(path: String) async throws -> ConstellagentProjectDirectoryListing {
        let response = try await sendRequest(
            method: "project/listDirectory",
            params: .object([
                "path": .string(path),
                "limit": .integer(200),
            ])
        )
        guard let object = response.result?.objectValue,
              let currentPath = object["path"]?.stringValue,
              let rawEntries = object["entries"]?.arrayValue else {
            throw ConstellagentServiceError.invalidResponse("project/listDirectory response missing entries")
        }

        return ConstellagentProjectDirectoryListing(
            path: currentPath,
            parentPath: object["parentPath"]?.stringValue,
            entries: rawEntries.compactMap(Self.decodeProjectDirectoryEntry)
        )
    }

    // Searches folder names under a selected root so the picker can jump across deep trees.
    func searchProjectDirectories(rootPath: String, query: String) async throws -> [ConstellagentProjectDirectoryEntry] {
        let response = try await sendRequest(
            method: "project/searchDirectories",
            params: .object([
                "path": .string(rootPath),
                "query": .string(query),
                "limit": .integer(80),
            ])
        )
        guard let rawEntries = response.result?.objectValue?["entries"]?.arrayValue else {
            throw ConstellagentServiceError.invalidResponse("project/searchDirectories response missing entries")
        }

        return rawEntries.compactMap(Self.decodeProjectDirectoryEntry)
    }

    // Creates a child folder on the Mac and returns the created absolute path.
    func createProjectDirectory(parentPath: String, name: String) async throws -> String {
        let response = try await sendRequest(
            method: "project/createDirectory",
            params: .object([
                "parentPath": .string(parentPath),
                "name": .string(name),
            ])
        )
        guard let path = response.result?.objectValue?["path"]?.stringValue else {
            throw ConstellagentServiceError.invalidResponse("project/createDirectory response missing path")
        }

        return path
    }

    // Asks the bridge to materialize a Constellagent-Desktop-style projectless chat root
    // (`~/Documents/Constellagent/<DATE>/<slug>` or its Windows equivalent) and returns
    // the absolute path so the iOS client can pass it as `cwd` to `thread/start`.
    // The bridge derives the slug from `promptHint`, falling back to `new-chat`
    // when no meaningful hint is available (e.g. the Quick Chat top button).
    func createRootlessChatRoot(promptHint: String?) async throws -> String {
        var params: [String: JSONValue] = [:]
        if let promptHint, !promptHint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            params["promptHint"] = .string(promptHint)
        }

        let response = try await sendRequest(
            method: "project/createRootlessChatRoot",
            params: .object(params)
        )
        guard let path = response.result?.objectValue?["path"]?.stringValue,
              !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ConstellagentServiceError.invalidResponse("project/createRootlessChatRoot response missing path")
        }

        return path
    }
}

private extension ConstellagentService {
    static func decodeProjectLocation(_ value: JSONValue) -> ConstellagentProjectLocation? {
        guard let object = value.objectValue,
              let id = object["id"]?.stringValue,
              let label = object["label"]?.stringValue,
              let path = object["path"]?.stringValue else {
            return nil
        }

        return ConstellagentProjectLocation(id: id, label: label, path: path)
    }

    static func decodeProjectDirectoryEntry(_ value: JSONValue) -> ConstellagentProjectDirectoryEntry? {
        guard let object = value.objectValue,
              let name = object["name"]?.stringValue,
              let path = object["path"]?.stringValue else {
            return nil
        }

        return ConstellagentProjectDirectoryEntry(
            name: name,
            path: path,
            isSymlink: object["isSymlink"]?.boolValue ?? false
        )
    }
}
