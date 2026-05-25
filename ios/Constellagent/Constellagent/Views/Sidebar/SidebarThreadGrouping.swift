// FILE: SidebarThreadGrouping.swift
// Purpose: Produces sidebar thread groups by project path (`cwd`) or rootless
//          chat scope while excluding archived chats.
// Layer: View Helper
// Exports: SidebarThreadGroupKind, SidebarContentScope, SidebarThreadGroup,
//          SidebarThreadGrouping

import Foundation

enum SidebarThreadGroupKind: Equatable {
    case pinned
    case project
    case chat
}

enum SidebarContentScope: String, CaseIterable, Hashable, Identifiable {
    case projects
    case chats

    var id: String { rawValue }

    var title: String {
        switch self {
        case .projects:
            return "Projects"
        case .chats:
            return "Chats"
        }
    }
}

enum SidebarThreadGroupingScope {
    case all
    case projects
    case chats
}

struct SidebarProjectChoice: Identifiable, Equatable {
    let id: String
    let label: String
    let iconSystemName: String
    let projectPath: String
    let sortDate: Date
}

struct SidebarThreadGroup: Identifiable {
    let id: String
    let label: String
    let kind: SidebarThreadGroupKind
    let sortDate: Date
    let projectPath: String?
    let threads: [ConstellagentThread]

    var iconSystemName: String {
        switch kind {
        case .pinned:
            return "pin"
        case .project:
            return ConstellagentThread.projectIconSystemName(for: projectPath)
        case .chat:
            return "bubble.left.and.bubble.right"
        }
    }

    func contains(_ thread: ConstellagentThread) -> Bool {
        threads.contains(where: { $0.id == thread.id })
    }
}

enum SidebarThreadGrouping {
    static func makeGroups(
        from threads: [ConstellagentThread],
        pinnedThreadIDs: [String] = [],
        scope: SidebarThreadGroupingScope = .all,
        projectlessRootPaths: [String] = [],
        now _: Date = Date(),
        calendar _: Calendar = .current
    ) -> [SidebarThreadGroup] {
        var groups: [SidebarThreadGroup] = []
        let scopedThreads = threadsForScope(scope, from: threads, projectlessRootPaths: projectlessRootPaths)
        let pinnedThreads = collectPinnedThreads(from: scopedThreads, pinnedRootThreadIDs: pinnedThreadIDs)
        let pinnedThreadIDSet = Set(pinnedThreads.map(\.id))

        if let firstPinned = pinnedThreads.first {
            groups.append(
                SidebarThreadGroup(
                    id: "pinned",
                    label: "Pinned",
                    kind: .pinned,
                    sortDate: firstPinned.updatedAt ?? firstPinned.createdAt ?? .distantPast,
                    projectPath: nil,
                    threads: pinnedThreads
                )
            )
        }

        switch scope {
        case .all:
            let projectThreads = threadsForScope(.projects, from: scopedThreads, projectlessRootPaths: projectlessRootPaths)
            let chatThreads = threadsForScope(.chats, from: scopedThreads, projectlessRootPaths: projectlessRootPaths)
            groups.append(contentsOf: makeProjectGroups(from: projectThreads, excludingPinnedThreadIDs: pinnedThreadIDSet))
            if let chatGroup = makeRootlessChatGroup(from: chatThreads, excludingPinnedThreadIDs: pinnedThreadIDSet) {
                groups.append(chatGroup)
            }
        case .projects:
            groups.append(contentsOf: makeProjectGroups(from: scopedThreads, excludingPinnedThreadIDs: pinnedThreadIDSet))
        case .chats:
            if let chatGroup = makeRootlessChatGroup(from: scopedThreads, excludingPinnedThreadIDs: pinnedThreadIDSet) {
                groups.append(chatGroup)
            }
        }

        return groups
    }

    // Keeps the UI picker from leaking project chats into rootless Chats and vice versa.
    static func threadsForScope(
        _ scope: SidebarThreadGroupingScope,
        from threads: [ConstellagentThread],
        projectlessRootPaths: [String] = []
    ) -> [ConstellagentThread] {
        switch scope {
        case .all:
            return threads
        case .projects:
            return threads.filter { !isRootlessChatThread($0, projectlessRootPaths: projectlessRootPaths) }
        case .chats:
            return threads.filter { isRootlessChatThread($0, projectlessRootPaths: projectlessRootPaths) }
        }
    }

    // Projectless chats still receive generated host-side working directories,
    // so rootless detection cannot rely on cwd == nil alone.
    static func isRootlessChatThread(
        _ thread: ConstellagentThread,
        projectlessRootPaths: [String] = []
    ) -> Bool {
        thread.normalizedProjectPath == nil
            || isUnderProjectlessRoot(thread.normalizedProjectPath, roots: projectlessRootPaths)
            || isGeneratedConstellagentProjectlessPath(thread.normalizedProjectPath)
    }

    // Reuses the sidebar project grouping rules for places like the New Chat chooser.
    static func makeProjectChoices(
        from threads: [ConstellagentThread],
        projectlessRootPaths: [String] = []
    ) -> [SidebarProjectChoice] {
        makeProjectGroups(from: threadsForScope(
            .projects,
            from: threads,
            projectlessRootPaths: projectlessRootPaths
        )).compactMap { group in
            guard let projectPath = group.projectPath else {
                return nil
            }

            return SidebarProjectChoice(
                id: group.id,
                label: group.label,
                iconSystemName: group.iconSystemName,
                projectPath: projectPath,
                sortDate: group.sortDate
            )
        }
    }

    // Resolves all live thread ids that belong to the tapped project, even if the visible group is filtered.
    static func liveThreadIDsForProjectGroup(_ group: SidebarThreadGroup, in threads: [ConstellagentThread]) -> [String] {
        guard group.kind == .project else {
            return []
        }

        return sortThreadsByRecentActivity(
            threads.filter { thread in
                thread.syncState != .archivedLocal && projectGroupID(for: thread) == group.id
            }
        ).map(\.id)
    }

    // Includes archived and pinned chats so local project removal fully hides the project on this device.
    static func allThreadIDsForProjectGroup(_ group: SidebarThreadGroup, in threads: [ConstellagentThread]) -> [String] {
        guard group.kind == .project else {
            return []
        }

        return sortThreadsByRecentActivity(
            threads.filter { thread in
                projectGroupID(for: thread) == group.id
            }
        ).map(\.id)
    }

    private static func makeProjectGroup(projectKey: String, threads: [ConstellagentThread]) -> SidebarThreadGroup {
        let sortedThreads = sortThreadsByRecentActivity(threads)
        let representativeThread = sortedThreads.first
        let sortDate = representativeThread?.updatedAt ?? representativeThread?.createdAt ?? .distantPast
        return SidebarThreadGroup(
            id: "project:\(projectKey)",
            label: representativeThread?.projectDisplayName ?? ConstellagentThread.noProjectDisplayName,
            kind: .project,
            sortDate: sortDate,
            projectPath: representativeThread?.normalizedProjectPath,
            threads: sortedThreads
        )
    }

    private static func makeRootlessChatGroup(
        from threads: [ConstellagentThread],
        excludingPinnedThreadIDs pinnedThreadIDs: Set<String>
    ) -> SidebarThreadGroup? {
        let liveThreads = threads.filter {
            $0.syncState != .archivedLocal && !pinnedThreadIDs.contains($0.id)
        }
        let sortedThreads = sortThreadsByRecentActivity(liveThreads)
        guard let firstThread = sortedThreads.first else {
            return nil
        }

        return SidebarThreadGroup(
            id: "chats:rootless",
            label: "Chats",
            kind: .chat,
            sortDate: firstThread.updatedAt ?? firstThread.createdAt ?? .distantPast,
            projectPath: nil,
            threads: sortedThreads
        )
    }

    private static func isUnderProjectlessRoot(_ rawPath: String?, roots: [String]) -> Bool {
        guard let normalizedPath = ConstellagentThread.normalizedFilesystemProjectPath(rawPath) else {
            return false
        }
        let pathComponents = projectPathComponents(normalizedPath)
        guard !pathComponents.isEmpty else {
            return false
        }

        return roots.contains { root in
            guard let normalizedRoot = ConstellagentThread.normalizedFilesystemProjectPath(root) else {
                return false
            }
            let rootComponents = projectPathComponents(normalizedRoot)
            guard !rootComponents.isEmpty, pathComponents.count >= rootComponents.count else {
                return false
            }

            return pathComponents.prefix(rootComponents.count).elementsEqual(rootComponents) {
                $0.localizedCaseInsensitiveCompare($1) == .orderedSame
            }
        }
    }

    private static func isGeneratedConstellagentProjectlessPath(_ rawPath: String?) -> Bool {
        guard let normalizedPath = ConstellagentThread.normalizedFilesystemProjectPath(rawPath) else {
            return false
        }

        let pathComponents = projectPathComponents(normalizedPath)
        return isGeneratedDocumentsConstellagentPath(pathComponents)
            || isConstellagentHomeThreadsPath(pathComponents)
    }

    private static func isGeneratedDocumentsConstellagentPath(_ components: [String]) -> Bool {
        for index in components.indices {
            let dateIndex = index + 2
            let slugIndex = index + 3
            guard components[index] == "Documents",
                  components.indices.contains(dateIndex),
                  components.indices.contains(slugIndex),
                  components[index + 1] == "Constellagent",
                  isISODateFolderName(components[dateIndex]),
                  !components[slugIndex].isEmpty else {
                continue
            }
            return true
        }

        return false
    }

    private static func isConstellagentHomeThreadsPath(_ components: [String]) -> Bool {
        for index in components.indices {
            let childIndex = index + 2
            guard components[index] == ".constellagent",
                  components.indices.contains(childIndex),
                  components[index + 1] == "threads",
                  !components[childIndex].isEmpty else {
                continue
            }
            return true
        }

        return false
    }

    private static func projectPathComponents(_ path: String) -> [String] {
        path
            .replacingOccurrences(of: "\\", with: "/")
            .split(separator: "/")
            .map(String.init)
    }

    private static func isISODateFolderName(_ value: String) -> Bool {
        let scalars = Array(value.unicodeScalars)
        guard scalars.count == 10,
              scalars[4].value == 45,
              scalars[7].value == 45 else {
            return false
        }

        return scalars.enumerated().allSatisfy { index, scalar in
            if index == 4 || index == 7 {
                return true
            }
            return CharacterSet.decimalDigits.contains(scalar)
        }
    }

    // Keeps project-derived UI consistent by centralizing the live-thread → project bucket mapping.
    private static func makeProjectGroups(
        from threads: [ConstellagentThread],
        excludingPinnedThreadIDs pinnedThreadIDs: Set<String> = []
    ) -> [SidebarThreadGroup] {
        var liveThreadsByProject: [String: [ConstellagentThread]] = [:]

        for thread in threads where thread.syncState != .archivedLocal {
            guard !pinnedThreadIDs.contains(thread.id) else {
                continue
            }
            liveThreadsByProject[thread.projectKey, default: []].append(thread)
        }

        return liveThreadsByProject.map { projectKey, projectThreads in
            makeProjectGroup(projectKey: projectKey, threads: projectThreads)
        }
        .sorted { lhs, rhs in
            if lhs.sortDate != rhs.sortDate {
                return lhs.sortDate > rhs.sortDate
            }

            if lhs.label != rhs.label {
                return lhs.label.localizedCaseInsensitiveCompare(rhs.label) == .orderedAscending
            }

            return lhs.id < rhs.id
        }
    }

    // Keeps pinned roots and their descendants together so sidebar trees do not split across sections.
    private static func collectPinnedThreads(
        from threads: [ConstellagentThread],
        pinnedRootThreadIDs: [String]
    ) -> [ConstellagentThread] {
        let liveThreads = threads.filter { $0.syncState != .archivedLocal }
        let threadsByID = Dictionary(uniqueKeysWithValues: liveThreads.map { ($0.id, $0) })
        let childrenByParentID = liveThreads.reduce(into: [String: [ConstellagentThread]]()) { partialResult, thread in
            guard let parentThreadID = thread.parentThreadId else {
                return
            }
            partialResult[parentThreadID, default: []].append(thread)
        }
        var pinnedThreads: [ConstellagentThread] = []
        var visitedThreadIDs: Set<String> = []

        for rootThreadID in pinnedRootThreadIDs {
            guard let rootThread = threadsByID[rootThreadID] else {
                continue
            }

            appendPinnedSubtree(
                rootThread,
                childrenByParentID: childrenByParentID,
                into: &pinnedThreads,
                visitedThreadIDs: &visitedThreadIDs
            )
        }

        return pinnedThreads
    }

    private static func appendPinnedSubtree(
        _ thread: ConstellagentThread,
        childrenByParentID: [String: [ConstellagentThread]],
        into pinnedThreads: inout [ConstellagentThread],
        visitedThreadIDs: inout Set<String>
    ) {
        guard visitedThreadIDs.insert(thread.id).inserted else {
            return
        }

        pinnedThreads.append(thread)

        for childThread in childrenByParentID[thread.id] ?? [] {
            appendPinnedSubtree(
                childThread,
                childrenByParentID: childrenByParentID,
                into: &pinnedThreads,
                visitedThreadIDs: &visitedThreadIDs
            )
        }
    }

    private static func sortThreadsByRecentActivity(_ threads: [ConstellagentThread]) -> [ConstellagentThread] {
        threads.sorted { lhs, rhs in
            let lhsDate = lhs.updatedAt ?? lhs.createdAt ?? .distantPast
            let rhsDate = rhs.updatedAt ?? rhs.createdAt ?? .distantPast
            if lhsDate != rhsDate {
                return lhsDate > rhsDate
            }
            return lhs.id < rhs.id
        }
    }

    private static func projectGroupID(for thread: ConstellagentThread) -> String {
        "project:\(thread.projectKey)"
    }
}
