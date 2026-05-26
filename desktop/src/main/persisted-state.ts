import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { app } from 'electron'

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

// Reads of `constellagent-state.json` are hot (per github poll, mobile RPC,
// notification routing) but the file only changes on user-driven writes, so
// stat the file first and only re-parse when mtime/size changed. The cached
// state is treated as read-only by all callers in this module.
let cachedState: PersistedStateRecord | null = null
let cachedMtimeNs: bigint | null = null
let cachedSize: number | null = null

export function invalidatePersistedStateCache(): void {
  cachedState = null
  cachedMtimeNs = null
  cachedSize = null
}

function loadState(): PersistedStateRecord {
  const filePath = stateFilePath()
  let stats: ReturnType<typeof statSync> | null = null
  try {
    stats = statSync(filePath, { bigint: true })
  } catch {
    invalidatePersistedStateCache()
    return {}
  }
  const mtimeNs = stats.mtimeNs
  const size = Number(stats.size)
  if (
    cachedState !== null &&
    cachedMtimeNs !== null &&
    cachedSize !== null &&
    mtimeNs === cachedMtimeNs &&
    size === cachedSize
  ) {
    return cachedState
  }
  if (!existsSync(filePath)) {
    invalidatePersistedStateCache()
    return {}
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as PersistedStateRecord
    cachedState = parsed
    cachedMtimeNs = mtimeNs
    cachedSize = size
    return parsed
  } catch {
    invalidatePersistedStateCache()
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
  worktreePath?: string
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
        ...(workspace.worktreePath ? { worktreePath: workspace.worktreePath } : {}),
        updatedAt: normalizeIsoDate(workspace.lastOpenedAt),
      }
    })
}

export function listPersistedWorkspaceRecords(): PersistedWorkspaceRecord[] {
  return loadState().workspaces ?? []
}

export function resolveMobileWorkspaceForPath(rawPath: string): {
  workspaceId: string
  workspacePath: string
} {
  const workspacePath = normalizePath(rawPath)
  const records = listPersistedWorkspaceRecords()
  for (const workspace of records) {
    if (!workspace.worktreePath) continue
    if (normalizePath(workspace.worktreePath) === workspacePath) {
      return { workspaceId: workspace.id, workspacePath }
    }
  }
  const slug = workspacePath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return {
    workspaceId: slug ? `mobile-path:${slug}` : 'mobile-path:unknown',
    workspacePath,
  }
}

export function resolveDefaultMobileWorkspacePath(): string | null {
  const workspaces = listPersistedMobileWorkspaces()
  const withPath = workspaces.find((workspace) => typeof workspace.worktreePath === 'string' && workspace.worktreePath.trim())
  return withPath?.worktreePath?.trim() || null
}

function normalizeIsoDate(value: unknown): string {
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

export function readPersistedPiCommitMessageModel(): string | undefined {
  const state = loadState()
  const raw = state.settings?.piCommitMessageModel
  if (typeof raw !== 'string') return undefined
  const t = raw.trim()
  return t || undefined
}

export interface UpsertMobileWorkspaceInput {
  readonly worktreePath: string
  readonly repoPath: string
  readonly branch: string
  readonly name?: string
}

export interface UpsertMobileWorkspaceResult {
  readonly workspaceId: string
  readonly projectId: string
  readonly worktreePath: string
  readonly branch: string
  readonly name: string
  readonly created: boolean
}

function saveState(state: PersistedStateRecord): void {
  const filePath = stateFilePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  invalidatePersistedStateCache()
}

/** Registers a git worktree as a persisted desktop workspace so mobile sessions mirror the sidebar. */
export function upsertPersistedMobileWorkspace(input: UpsertMobileWorkspaceInput): UpsertMobileWorkspaceResult {
  const worktreePath = normalizePath(input.worktreePath.trim())
  const repoPath = normalizePath(input.repoPath.trim())
  const branch = input.branch.trim() || 'main'
  const state = loadState()
  const projects = [...(state.projects ?? [])]
  const workspaces = [...(state.workspaces ?? [])]

  for (const workspace of workspaces) {
    if (!workspace.worktreePath) continue
    if (normalizePath(workspace.worktreePath) !== worktreePath) continue
    const project = projects.find((entry) => entry.id === workspace.projectId)
    return {
      workspaceId: workspace.id,
      projectId: workspace.projectId,
      worktreePath,
      branch: workspace.branch ?? branch,
      name: input.name?.trim() || workspace.branch || basename(worktreePath),
      created: false,
    }
  }

  let project = projects.find((entry) => normalizePath(entry.repoPath) === repoPath) ?? null
  if (!project) {
    project = {
      id: randomUUID(),
      name: basename(repoPath),
      repoPath,
    }
    projects.push(project)
  }

  const workspaceId = randomUUID()
  const name = input.name?.trim() || `[${basename(worktreePath)}]` || branch
  workspaces.push({
    id: workspaceId,
    projectId: project.id,
    branch,
    worktreePath,
    lastOpenedAt: new Date().toISOString(),
  })

  saveState({
    ...state,
    projects,
    workspaces,
  })

  return {
    workspaceId,
    projectId: project.id,
    worktreePath,
    branch,
    name,
    created: true,
  }
}
