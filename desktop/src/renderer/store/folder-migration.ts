import type { PersistedState, Workspace } from './types'

/** Drop the removed legacy `folderId` field from a workspace, if present. */
export function stripWorkspaceFolderId(ws: Workspace): Workspace {
  if (!('folderId' in (ws as unknown as Record<string, unknown>))) return ws
  const { folderId: _folderId, ...rest } = ws as Workspace & { folderId?: string }
  return rest
}

/**
 * One-time migration from the removed Folder layer to pin overrides. Workspaces
 * that lived in their project's Priority folder become `pinned` (preserving
 * their in-folder order via incremental `pinOrder`); every other `folderId` is
 * dropped. Idempotent: once `data.folders` is absent it only strips residual
 * `folderId` (a no-op for already-migrated state).
 */
export function migrateFoldersToOverrides(data: PersistedState, workspaces: Workspace[]): Workspace[] {
  if (!data.folders) {
    return workspaces.map(stripWorkspaceFolderId)
  }

  const rawProjects = (data.projects ?? []) as Array<{ priorityFolderId?: string | null }>
  const priorityFolderIds = new Set<string>()
  for (const project of rawProjects) {
    if (project.priorityFolderId) priorityFolderIds.add(project.priorityFolderId)
  }

  const folderIdByWorkspaceId = new Map<string, string | undefined>()
  for (const raw of (data.workspaces ?? []) as Array<{ id: string; folderId?: string }>) {
    folderIdByWorkspaceId.set(raw.id, raw.folderId)
  }

  // Array order is the persisted (in-folder, per-project) order — iterating it
  // and handing out an incremental pinOrder preserves what the user prioritized.
  let pinOrder = 0
  return workspaces.map((ws) => {
    const stripped = stripWorkspaceFolderId(ws)
    const folderId = folderIdByWorkspaceId.get(ws.id)
    if (folderId && priorityFolderIds.has(folderId)) {
      return { ...stripped, pinned: true, pinOrder: pinOrder++ }
    }
    return stripped
  })
}
