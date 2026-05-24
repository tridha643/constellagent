import { app } from 'electron'
import { existsSync, readFileSync, realpathSync } from 'fs'
import { join, resolve } from 'path'

interface PersistedProjectRecord {
  id: string
  name?: string
  repoPath: string
}

interface PersistedWorkspaceRecord {
  id: string
  projectId: string
  branch?: string
  worktreePath?: string
  lastOpenedAt?: string
}

interface PersistedStateRecord {
  projects?: PersistedProjectRecord[]
  workspaces?: PersistedWorkspaceRecord[]
  settings?: { piCommitMessageModel?: unknown }
}

function stateFilePath(): string {
  return join(app.getPath('userData'), 'constellagent-state.json')
}

function normalizePath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function loadState(): PersistedStateRecord {
  const filePath = stateFilePath()
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as PersistedStateRecord
  } catch {
    return {}
  }
}

export function lookupPersistedWorkspace(workspaceId: string): {
  projectId?: string
  branch?: string
  repoPath?: string
} {
  if (!workspaceId) return {}
  const state = loadState()
  const workspace = state.workspaces?.find((entry) => entry.id === workspaceId)
  if (!workspace) return {}
  const project = state.projects?.find((entry) => entry.id === workspace.projectId)
  return {
    projectId: workspace.projectId,
    branch: workspace.branch,
    repoPath: project?.repoPath,
  }
}

export function lookupPersistedProjectByRepoPath(repoPath: string): PersistedProjectRecord | null {
  if (!repoPath) return null
  const state = loadState()
  const normalizedTarget = normalizePath(repoPath)
  for (const project of state.projects ?? []) {
    if (!project.repoPath) continue
    if (normalizePath(project.repoPath) === normalizedTarget) {
      return project
    }
  }
  return null
}

export function lookupPersistedProjectRepo(projectId: string): string | null {
  if (!projectId) return null
  const state = loadState()
  const project = state.projects?.find((entry) => entry.id === projectId)
  return project?.repoPath ?? null
}

export function listPersistedProjectsWithBranches(): Array<{
  projectId: string
  repoPath: string
  branches: string[]
}> {
  const state = loadState()
  const projects = new Map<string, { repoPath: string; branches: Set<string> }>()

  for (const project of state.projects ?? []) {
    if (!project.id || !project.repoPath) continue
    projects.set(project.id, { repoPath: project.repoPath, branches: new Set<string>() })
  }

  for (const workspace of state.workspaces ?? []) {
    if (!workspace.projectId || !workspace.branch) continue
    const entry = projects.get(workspace.projectId)
    if (!entry) continue
    if (workspace.branch.trim()) entry.branches.add(workspace.branch.trim())
  }

  return Array.from(projects.entries()).map(([projectId, value]) => ({
    projectId,
    repoPath: value.repoPath,
    branches: Array.from(value.branches).sort(),
  }))
}

export function listPersistedMobileWorkspaces(): Array<{
  id: string
  projectId?: string
  name: string
  branch?: string
  updatedAt: string
}> {
  const state = loadState()
  const projects = new Map((state.projects ?? []).map((project) => [project.id, project]))
  return (state.workspaces ?? [])
    .filter((workspace) => typeof workspace.id === 'string' && workspace.id.trim())
    .map((workspace) => {
      const project = projects.get(workspace.projectId)
      return {
        id: workspace.id,
        ...(workspace.projectId ? { projectId: workspace.projectId } : {}),
        name: project?.name || workspace.branch || workspace.id,
        ...(workspace.branch ? { branch: workspace.branch } : {}),
        updatedAt: normalizeIsoDate(workspace.lastOpenedAt),
      }
    })
}

function normalizeIsoDate(value: unknown): string {
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

/** Pi model id for commit message generation; empty/undefined means use app default in pi-run-prompt. */
export function readPersistedPiCommitMessageModel(): string | undefined {
  const state = loadState()
  const raw = state.settings?.piCommitMessageModel
  if (typeof raw !== 'string') return undefined
  const t = raw.trim()
  return t || undefined
}
