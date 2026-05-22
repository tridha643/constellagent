import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [appPath], env: { ...process.env, CI_TEST: '1' } })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

function createTestRepo(name: string): string {
  const repoPath = join('/tmp', `test-repo-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function cleanupTestRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true })
    const parentDir = resolve(repoPath, '..')
    const repoName = repoPath.split('/').pop()
    if (repoName) {
      const entries = readdirSync(parentDir)
      for (const entry of entries) {
        if (entry.startsWith(`${repoName}-ws-`)) {
          rmSync(join(parentDir, entry), { recursive: true, force: true })
        }
      }
    }
  } catch {
    // best effort
  }
}

test.describe('Sidebar folders', () => {
  test('adding a project seeds Priority + Non-Priority folders', async () => {
    const repo = createTestRepo('folders-seed')
    const { app, window } = await launchApp()
    try {
      const folderNames = await window.evaluate((repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-folders-seed', repoPath })
        const s = (window as any).__store.getState()
        return s.folders
          .filter((f: any) => f.projectId === projectId)
          .sort((a: any, b: any) => a.order - b.order)
          .map((f: any) => f.name)
      }, repo)
      expect(folderNames).toEqual(['Priority', 'Non-Priority'])
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('new workspace lands in the Non-Priority (default) folder', async () => {
    const repo = createTestRepo('folders-default')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-default', repoPath })
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-default', 'branch-default', true)
        const wsId = crypto.randomUUID()
        store.addWorkspace({
          id: wsId, name: 'ws-default', branch: 'branch-default', worktreePath: wt, projectId,
        })
        const s = (window as any).__store.getState()
        const project = s.projects.find((p: any) => p.id === projectId)
        const ws = s.workspaces.find((w: any) => w.id === wsId)
        return { defaultFolderId: project.defaultFolderId, wsFolderId: ws.folderId }
      }, repo)
      expect(result.wsFolderId).toBe(result.defaultFolderId)
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('togglePriorityForWorkspace moves the workspace between Priority and default', async () => {
    const repo = createTestRepo('folders-star')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-star', repoPath })
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-star', 'branch-star', true)
        const wsId = crypto.randomUUID()
        store.addWorkspace({
          id: wsId, name: 'ws-star', branch: 'branch-star', worktreePath: wt, projectId,
        })

        const initial = (window as any).__store.getState().workspaces.find((w: any) => w.id === wsId).folderId
        ;(window as any).__store.getState().togglePriorityForWorkspace(wsId)
        const afterPriority = (window as any).__store.getState().workspaces.find((w: any) => w.id === wsId).folderId
        ;(window as any).__store.getState().togglePriorityForWorkspace(wsId)
        const afterToggleBack = (window as any).__store.getState().workspaces.find((w: any) => w.id === wsId).folderId

        const s = (window as any).__store.getState()
        const project = s.projects.find((p: any) => p.id === projectId)
        return { initial, afterPriority, afterToggleBack, priorityFolderId: project.priorityFolderId, defaultFolderId: project.defaultFolderId }
      }, repo)
      expect(result.initial).toBe(result.defaultFolderId)
      expect(result.afterPriority).toBe(result.priorityFolderId)
      expect(result.afterToggleBack).toBe(result.defaultFolderId)
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('moveWorkspaceToFolder moves a workspace between folders', async () => {
    const repo = createTestRepo('folders-move')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-move', repoPath })
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-move', 'branch-move', true)
        const wsId = crypto.randomUUID()
        store.addWorkspace({
          id: wsId, name: 'ws-move', branch: 'branch-move', worktreePath: wt, projectId,
        })
        const targetFolderId = (window as any).__store.getState().addFolder(projectId, 'Review')
        ;(window as any).__store.getState().moveWorkspaceToFolder(wsId, targetFolderId)
        const ws = (window as any).__store.getState().workspaces.find((w: any) => w.id === wsId)
        return { wsFolderId: ws.folderId, targetFolderId }
      }, repo)
      expect(result.wsFolderId).toBe(result.targetFolderId)
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('reorderFolder persists custom folder order', async () => {
    const repo = createTestRepo('folders-reorder')
    const { app, window } = await launchApp()
    try {
      const folderNames = await window.evaluate((repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-reorder', repoPath })
        const reviewFolderId = store.addFolder(projectId, 'Review')

        const s1 = (window as any).__store.getState()
        const priorityFolder = s1.folders.find((f: any) => (
          f.projectId === projectId && f.name === 'Priority'
        ))
        ;(window as any).__store.getState().reorderFolder(reviewFolderId, priorityFolder.id)

        return (window as any).__store.getState().folders
          .filter((f: any) => f.projectId === projectId)
          .sort((a: any, b: any) => a.order - b.order)
          .map((f: any) => f.name)
      }, repo)
      expect(folderNames).toEqual(['Review', 'Priority', 'Non-Priority'])
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('moveWorkspaceToFolderBefore places a workspace before a target in another folder', async () => {
    const repo = createTestRepo('folders-place-before')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate((repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-place-before', repoPath })
        const reviewFolderId = store.addFolder(projectId, 'Review')

        const wsA = crypto.randomUUID()
        const wsB = crypto.randomUUID()
        const wsC = crypto.randomUUID()
        store.addWorkspace({ id: wsA, name: 'alpha', branch: 'alpha', worktreePath: repoPath, projectId })
        store.addWorkspace({ id: wsB, name: 'beta', branch: 'beta', worktreePath: repoPath, projectId })
        store.addWorkspace({ id: wsC, name: 'gamma', branch: 'gamma', worktreePath: repoPath, projectId })

        ;(window as any).__store.getState().moveWorkspaceToFolder(wsB, reviewFolderId)
        ;(window as any).__store.getState().moveWorkspaceToFolderBefore(wsC, reviewFolderId, wsB)

        const s = (window as any).__store.getState()
        const reviewWorkspaceNames = s.workspaces
          .filter((w: any) => w.folderId === reviewFolderId)
          .map((w: any) => w.name)
        const moved = s.workspaces.find((w: any) => w.id === wsC)

        return { reviewWorkspaceNames, movedFolderId: moved.folderId, reviewFolderId }
      }, repo)
      expect(result.movedFolderId).toBe(result.reviewFolderId)
      expect(result.reviewWorkspaceNames).toEqual(['gamma', 'beta'])
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('folder collapse state persists across hydrateState round trip', async () => {
    const repo = createTestRepo('folders-collapse')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-collapse', repoPath })
        const s1 = (window as any).__store.getState()
        const priorityFolder = s1.folders.find((f: any) => f.projectId === projectId && f.id === s1.projects.find((p: any) => p.id === projectId).priorityFolderId)
        s1.toggleFolderCollapsed(priorityFolder.id)
        const collapsedBefore = (window as any).__store.getState().folders.find((f: any) => f.id === priorityFolder.id).collapsed

        // Round-trip through hydrateState
        const snapshot = {
          projects: (window as any).__store.getState().projects,
          workspaces: (window as any).__store.getState().workspaces,
          folders: (window as any).__store.getState().folders,
        }
        ;(window as any).__store.getState().hydrateState({ projects: [], workspaces: [] })
        ;(window as any).__store.getState().hydrateState(snapshot)
        const collapsedAfter = (window as any).__store.getState().folders.find((f: any) => f.id === priorityFolder.id)?.collapsed
        return { collapsedBefore, collapsedAfter }
      }, repo)
      expect(result.collapsedBefore).toBe(true)
      expect(result.collapsedAfter).toBe(true)
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('deleting a folder reassigns its workspaces to the default folder', async () => {
    const repo = createTestRepo('folders-delete')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-delete', repoPath })
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-delete', 'branch-delete', true)
        const wsId = crypto.randomUUID()
        store.addWorkspace({
          id: wsId, name: 'ws-delete', branch: 'branch-delete', worktreePath: wt, projectId,
        })
        const newFolderId = (window as any).__store.getState().addFolder(projectId, 'Review')
        ;(window as any).__store.getState().moveWorkspaceToFolder(wsId, newFolderId)
        ;(window as any).__store.getState().removeFolder(newFolderId)

        const s = (window as any).__store.getState()
        const ws = s.workspaces.find((w: any) => w.id === wsId)
        const project = s.projects.find((p: any) => p.id === projectId)
        const folderExists = s.folders.some((f: any) => f.id === newFolderId)
        return { wsFolderId: ws.folderId, defaultFolderId: project.defaultFolderId, folderExists }
      }, repo)
      expect(result.folderExists).toBe(false)
      expect(result.wsFolderId).toBe(result.defaultFolderId)
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('legacy state hydration without folders seeds defaults and assigns workspaces', async () => {
    const repo = createTestRepo('folders-legacy')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-legacy', 'branch-legacy', true)
        const projectId = 'legacy-project-id'
        const wsId = 'legacy-ws-id'
        ;(window as any).__store.getState().hydrateState({
          projects: [{ id: projectId, name: 'project-legacy', repoPath }],
          workspaces: [{ id: wsId, name: 'ws-legacy', branch: 'branch-legacy', worktreePath: wt, projectId }],
        })
        const s = (window as any).__store.getState()
        const project = s.projects.find((p: any) => p.id === projectId)
        const ws = s.workspaces.find((w: any) => w.id === wsId)
        return {
          folderCount: s.folders.filter((f: any) => f.projectId === projectId).length,
          defaultFolderId: project.defaultFolderId,
          priorityFolderId: project.priorityFolderId,
          wsFolderId: ws.folderId,
        }
      }, repo)
      expect(result.folderCount).toBe(2)
      expect(result.defaultFolderId).toBeTruthy()
      expect(result.priorityFolderId).toBeTruthy()
      expect(result.wsFolderId).toBe(result.defaultFolderId)
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })
})
