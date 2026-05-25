import { BrowserWindow } from 'electron'
import { basename } from 'node:path'
import { IPC } from '../shared/ipc-channels'
import { GitService } from './git-service'
import {
  lookupPersistedProjectByRepoPath,
  upsertPersistedMobileWorkspace,
  type UpsertMobileWorkspaceResult,
} from './persisted-state'

export interface MobileWorkspaceCreatedPayload {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly repoPath: string
  }
  readonly workspace: {
    readonly id: string
    readonly name: string
    readonly branch: string
    readonly worktreePath: string
    readonly projectId: string
  }
}

export function broadcastMobileWorkspaceCreated(payload: MobileWorkspaceCreatedPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC.MOBILE_WORKSPACE_CREATED, payload)
  }
}

export async function registerMobileWorkspaceForPath(options: {
  worktreePath: string
  branch?: string
  name?: string
  notifyRenderer?: boolean
}): Promise<UpsertMobileWorkspaceResult> {
  const worktreePath = options.worktreePath.trim()
  if (!worktreePath) {
    throw new Error('A worktree path is required.')
  }

  const repoPath = await GitService.getProjectRepoAnchor(worktreePath)
  if (!repoPath) {
    throw new Error('Could not resolve the repository root for this worktree.')
  }

  const branch = options.branch?.trim()
    || await GitService.getCurrentBranch(worktreePath).catch(() => '')
    || 'main'

  const managedToken = extractManagedWorktreeToken(worktreePath)
  const name = options.name?.trim()
    || (managedToken ? `[${managedToken}]` : basename(worktreePath))

  const result = upsertPersistedMobileWorkspace({
    worktreePath,
    repoPath,
    branch,
    name,
  })

  if (options.notifyRenderer !== false) {
    const existingProject = lookupPersistedProjectByRepoPath(repoPath)
    broadcastMobileWorkspaceCreated({
      project: {
        id: result.projectId,
        name: existingProject?.name ?? basename(repoPath),
        repoPath,
      },
      workspace: {
        id: result.workspaceId,
        name: result.name,
        branch: result.branch,
        worktreePath: result.worktreePath,
        projectId: result.projectId,
      },
    })
  }

  return result
}

export function extractManagedWorktreeToken(worktreePath: string): string | null {
  const normalized = worktreePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const marker = '/.constellagent/worktrees/'
  const index = normalized.indexOf(marker)
  if (index < 0) return null
  const remainder = normalized.slice(index + marker.length)
  const token = remainder.split('/')[0]?.trim()
  return token || null
}

export function isManagedWorktreePath(worktreePath: string): boolean {
  return extractManagedWorktreeToken(worktreePath) != null
}
