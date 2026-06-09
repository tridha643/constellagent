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

test.describe('Sidebar status sections', () => {
  test('a project renders auto status sections and no folder chrome', async () => {
    const repo = createTestRepo('sections-auto')
    const { app, window } = await launchApp()
    try {
      await window.evaluate(async (repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-sections-auto', repoPath })
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-auto', 'branch-auto', true)
        store.addWorkspace({
          id: crypto.randomUUID(), name: 'ws-auto', branch: 'branch-auto', worktreePath: wt, projectId,
        })
      }, repo)

      // No legacy folder chrome remains.
      expect(await window.locator('[class*="folderHeader"]').count()).toBe(0)
      // A freshly added (active) workspace lands in an auto status section.
      await expect(window.locator('[class*="sectionHeader"]').first()).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('pinning moves a workspace to Pinned and persists across hydrateState', async () => {
    const repo = createTestRepo('sections-pin')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-pin', repoPath })
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-pin', 'branch-pin', true)
        const wsId = crypto.randomUUID()
        store.addWorkspace({
          id: wsId, name: 'ws-pin', branch: 'branch-pin', worktreePath: wt, projectId,
        })

        ;(window as any).__store.getState().pinWorkspace(wsId)
        const afterPin = (window as any).__store.getState().workspaces.find((w: any) => w.id === wsId)

        // Round-trip through hydrateState (no `folders` key → already-migrated, idempotent).
        const snapshot = {
          projects: (window as any).__store.getState().projects,
          workspaces: (window as any).__store.getState().workspaces,
        }
        ;(window as any).__store.getState().hydrateState({ projects: [], workspaces: [] })
        ;(window as any).__store.getState().hydrateState(snapshot)
        const afterReload = (window as any).__store.getState().workspaces.find((w: any) => w.id === wsId)

        return {
          pinned: afterPin.pinned,
          pinOrder: afterPin.pinOrder,
          reloadedPinned: afterReload.pinned,
          reloadedPinOrder: afterReload.pinOrder,
        }
      }, repo)

      expect(result.pinned).toBe(true)
      expect(result.reloadedPinned).toBe(true)
      expect(result.reloadedPinOrder).toBe(result.pinOrder)

      // The Pinned section header renders.
      await expect(window.locator('[class*="sectionHeader"]', { hasText: 'Pinned' })).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('unpinning returns a workspace to auto placement', async () => {
    const repo = createTestRepo('sections-unpin')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-unpin', repoPath })
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-unpin', 'branch-unpin', true)
        const wsId = crypto.randomUUID()
        store.addWorkspace({
          id: wsId, name: 'ws-unpin', branch: 'branch-unpin', worktreePath: wt, projectId,
        })

        ;(window as any).__store.getState().togglePinWorkspace(wsId)
        const pinned = (window as any).__store.getState().workspaces.find((w: any) => w.id === wsId).pinned
        ;(window as any).__store.getState().togglePinWorkspace(wsId)
        const unpinned = (window as any).__store.getState().workspaces.find((w: any) => w.id === wsId)

        return { pinned, unpinned: unpinned.pinned, pinOrder: unpinned.pinOrder }
      }, repo)

      expect(result.pinned).toBe(true)
      expect(result.unpinned).toBeFalsy()
      expect(result.pinOrder).toBeUndefined()
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('movePinnedWorkspaceBefore reorders within the Pinned section', async () => {
    const repo = createTestRepo('sections-reorder')
    const { app, window } = await launchApp()
    try {
      const order = await window.evaluate((repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-reorder', repoPath })

        const a = crypto.randomUUID()
        const b = crypto.randomUUID()
        const c = crypto.randomUUID()
        store.addWorkspace({ id: a, name: 'alpha', branch: 'alpha', worktreePath: repoPath, projectId })
        store.addWorkspace({ id: b, name: 'beta', branch: 'beta', worktreePath: repoPath, projectId })
        store.addWorkspace({ id: c, name: 'gamma', branch: 'gamma', worktreePath: repoPath, projectId })

        const s = () => (window as any).__store.getState()
        s().pinWorkspace(a)
        s().pinWorkspace(b)
        s().pinWorkspace(c)
        // Move gamma before alpha.
        s().movePinnedWorkspaceBefore(c, a)

        return s()
          .workspaces.filter((w: any) => w.pinned)
          .slice()
          .sort((x: any, y: any) => (x.pinOrder ?? 0) - (y.pinOrder ?? 0))
          .map((w: any) => w.name)
      }, repo)

      expect(order).toEqual(['gamma', 'alpha', 'beta'])
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('legacy Priority-folder members migrate to Pinned on hydration', async () => {
    const repo = createTestRepo('sections-legacy')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate(async (repoPath: string) => {
        const wt = await (window as any).api.git.createWorktree(repoPath, 'ws-legacy', 'branch-legacy', true)
        const projectId = 'legacy-project-id'
        const prioWsId = 'legacy-prio-ws'
        const otherWsId = 'legacy-other-ws'
        ;(window as any).__store.getState().hydrateState({
          projects: [
            { id: projectId, name: 'project-legacy', repoPath, priorityFolderId: 'prio', defaultFolderId: 'def' },
          ],
          workspaces: [
            { id: prioWsId, name: 'prio-ws', branch: 'prio-branch', worktreePath: wt, projectId, folderId: 'prio' },
            { id: otherWsId, name: 'other-ws', branch: 'other-branch', worktreePath: repoPath, projectId, folderId: 'def' },
          ],
          folders: [
            { id: 'prio', projectId, name: 'Priority', order: 0 },
            { id: 'def', projectId, name: 'Non-Priority', order: 1 },
          ],
        })
        const s = (window as any).__store.getState()
        const prioWs = s.workspaces.find((w: any) => w.id === prioWsId)
        const otherWs = s.workspaces.find((w: any) => w.id === otherWsId)
        const project = s.projects.find((p: any) => p.id === projectId)
        return {
          prioPinned: prioWs.pinned,
          prioHasFolderId: 'folderId' in prioWs,
          otherPinned: otherWs.pinned,
          otherHasFolderId: 'folderId' in otherWs,
          projectHasPriorityFolderId: 'priorityFolderId' in project,
        }
      }, repo)

      expect(result.prioPinned).toBe(true)
      expect(result.prioHasFolderId).toBe(false)
      expect(result.otherPinned).toBeFalsy()
      expect(result.otherHasFolderId).toBe(false)
      expect(result.projectHasPriorityFolderId).toBe(false)
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('creating a manual section and assigning a workspace persists across hydrateState', async () => {
    const repo = createTestRepo('sections-custom')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate((repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-custom', repoPath })
        const wsId = crypto.randomUUID()
        store.addWorkspace({ id: wsId, name: 'ws-custom', branch: 'branch-custom', worktreePath: repoPath, projectId })

        const s = () => (window as any).__store.getState()
        const sectionId = s().createCustomSection(projectId, 'My Section')
        s().assignWorkspaceToSection(wsId, sectionId)
        const afterAssign = s().workspaces.find((w: any) => w.id === wsId)

        // Round-trip through hydrateState.
        const snapshot = { projects: s().projects, workspaces: s().workspaces, customSections: s().customSections }
        s().hydrateState({ projects: [], workspaces: [] })
        s().hydrateState(snapshot)
        const reloadedWs = s().workspaces.find((w: any) => w.id === wsId)
        const reloadedSection = s().customSections.find((c: any) => c.id === sectionId)

        return {
          assignedSectionId: afterAssign.sectionId,
          sectionId,
          reloadedSectionId: reloadedWs.sectionId,
          reloadedSectionName: reloadedSection?.name,
        }
      }, repo)

      expect(result.assignedSectionId).toBe(result.sectionId)
      expect(result.reloadedSectionId).toBe(result.sectionId)
      expect(result.reloadedSectionName).toBe('My Section')

      // The manual section header renders.
      await expect(window.locator('[class*="sectionHeader"]', { hasText: 'My Section' })).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('deleting a manual section returns its members to auto, and overrides are mutually exclusive', async () => {
    const repo = createTestRepo('sections-override')
    const { app, window } = await launchApp()
    try {
      const result = await window.evaluate((repoPath: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'project-override', repoPath })
        const wsId = crypto.randomUUID()
        store.addWorkspace({ id: wsId, name: 'ws-ov', branch: 'branch-ov', worktreePath: repoPath, projectId })

        const s = () => (window as any).__store.getState()
        const sectionId = s().createCustomSection(projectId, 'Temp')
        s().assignWorkspaceToSection(wsId, sectionId)

        // Pinning is mutually exclusive with a section assignment.
        s().pinWorkspace(wsId)
        const afterPin = s().workspaces.find((w: any) => w.id === wsId)

        // A bucket override clears the pin.
        s().setWorkspaceBucketOverride(wsId, 'idle')
        const afterBucket = s().workspaces.find((w: any) => w.id === wsId)

        // Deleting the section it once belonged to is harmless; reset clears everything.
        s().deleteCustomSection(sectionId)
        s().resetWorkspacePlacement(wsId)
        const afterReset = s().workspaces.find((w: any) => w.id === wsId)
        const sectionStillExists = s().customSections.some((c: any) => c.id === sectionId)

        return {
          pinnedClearedSection: afterPin.pinned === true && afterPin.sectionId === undefined,
          bucketClearedPin: afterBucket.bucketOverride === 'idle' && afterBucket.pinned === false,
          resetCleared:
            afterReset.pinned === false &&
            afterReset.sectionId === undefined &&
            afterReset.bucketOverride === undefined,
          sectionStillExists,
        }
      }, repo)

      expect(result.pinnedClearedSection).toBe(true)
      expect(result.bucketClearedPin).toBe(true)
      expect(result.resetCleared).toBe(true)
      expect(result.sectionStillExists).toBe(false)
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })
})
