import type { Folder, Project, Workspace } from './types'

export function getVisibleProjects(projects: Project[]): Project[] {
  return projects
}

export function getRenderableProjectWorkspaces(workspaces: Workspace[], projectId: string): Workspace[] {
  return workspaces.filter((workspace) => workspace.projectId === projectId)
}

export interface FolderGroup {
  folder: Folder
  workspaces: Workspace[]
}

/**
 * Group a project's workspaces by their `folderId`, preserving the existing
 * workspace order within each folder. Workspaces with no folder (or one that
 * no longer exists) fall under the project's `defaultFolderId`. Folders are
 * returned ordered by `folder.order`.
 */
export function getRenderableFolderGroups(
  projectId: string,
  folders: Folder[],
  workspaces: Workspace[],
  defaultFolderId: string | null | undefined,
): FolderGroup[] {
  const projectFolders = folders
    .filter((f) => f.projectId === projectId)
    .slice()
    .sort((a, b) => a.order - b.order)
  if (projectFolders.length === 0) return []
  const folderIds = new Set(projectFolders.map((f) => f.id))
  const fallbackId =
    defaultFolderId && folderIds.has(defaultFolderId)
      ? defaultFolderId
      : projectFolders[0]!.id
  const byFolder = new Map<string, Workspace[]>()
  for (const f of projectFolders) byFolder.set(f.id, [])
  for (const ws of workspaces) {
    if (ws.projectId !== projectId) continue
    const fid = ws.folderId && folderIds.has(ws.folderId) ? ws.folderId : fallbackId
    byFolder.get(fid)!.push(ws)
  }
  return projectFolders.map((folder) => ({ folder, workspaces: byFolder.get(folder.id) ?? [] }))
}

export function getVisibleWorkspaces(
  projects: Project[],
  workspaces: Workspace[],
  collapsedProjectIds: Set<string>,
): Workspace[] {
  return getVisibleProjects(projects).flatMap((project) => (
    collapsedProjectIds.has(project.id)
      ? []
      : getRenderableProjectWorkspaces(workspaces, project.id)
  ))
}

export function resolveProjectTargetWorkspace(
  projectId: string,
  workspaces: Workspace[],
  lastActiveWorkspaceByProjectId: Record<string, string>,
): Workspace | undefined {
  const candidates = getRenderableProjectWorkspaces(workspaces, projectId)
  if (candidates.length === 0) return undefined

  const preferredId = lastActiveWorkspaceByProjectId[projectId]
  if (preferredId) {
    const preferred = candidates.find((workspace) => workspace.id === preferredId)
    if (preferred) return preferred
  }

  return candidates[0]
}

export function getSwitchableVisibleProjects(
  projects: Project[],
  workspaces: Workspace[],
  lastActiveWorkspaceByProjectId: Record<string, string>,
): Project[] {
  return getVisibleProjects(projects).filter((project) => (
    !!resolveProjectTargetWorkspace(project.id, workspaces, lastActiveWorkspaceByProjectId)
  ))
}
