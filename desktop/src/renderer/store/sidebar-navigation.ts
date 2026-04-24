import type { Project, Workspace } from './types'

export function getVisibleProjects(projects: Project[]): Project[] {
  return projects
}

export function getRenderableProjectWorkspaces(workspaces: Workspace[], projectId: string): Workspace[] {
  return workspaces.filter((workspace) => workspace.projectId === projectId)
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
