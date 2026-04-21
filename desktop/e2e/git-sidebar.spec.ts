import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, realpathSync, readFileSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'

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
  mkdirSync(join(repoPath, 'src'), { recursive: true })
  writeFileSync(join(repoPath, 'src/index.ts'), 'console.log("hello")\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function cleanupTestRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) {
      rmSync(repoPath, { recursive: true, force: true })
    }
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
    const t3RepoName = repoPath.split('/').pop()
    if (t3RepoName) {
      rmSync(join(homedir(), '.t3', 'worktrees', t3RepoName), { recursive: true, force: true })
    }
  } catch {
    // best effort
  }
}

function normalizeMacPath(value: string): string {
  return value.replace(/^\/private/, '')
}

test.describe('Git & Sidebar functionality', () => {
  test('add project via store shows in sidebar', async () => {
    const repoPath = createTestRepo('sidebar-1')
    const { app, window } = await launchApp()

    try {
      // Clear persisted state, then add project
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        store.addProject({
          id: crypto.randomUUID(),
          name: 'my-test-project',
          repoPath: repo,
        })
      }, repoPath)

      await window.waitForTimeout(500)

      // Verify project name shows in sidebar
      const projectHeader = window.locator('[class*="projectHeader"]', { hasText: 'my-test-project' }).first()
      await expect(projectHeader).toBeVisible()

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/sidebar-project-added.png'),
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('create workspace via IPC produces worktree on disk', async () => {
    const repoPath = createTestRepo('git-ws')
    const { app, window } = await launchApp()

    try {
      // Create worktree via IPC
      const worktreePath = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.createWorktree(repo, 'e2e-ws', 'e2e-branch', true)
      }, repoPath)

      expect(worktreePath).toBeTruthy()
      expect(worktreePath).toContain('-ws-e2e-ws')

      // Verify worktree directory exists on disk
      expect(existsSync(worktreePath as string)).toBe(true)

      // List worktrees and verify our new one is there
      const worktrees = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.listWorktrees(repo)
      }, repoPath)

      expect(worktrees.length).toBeGreaterThanOrEqual(2) // main + our worktree
      const found = worktrees.find((wt: any) => wt.branch === 'e2e-branch')
      expect(found).toBeTruthy()
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('replacing a workspace keeps it registered as a valid git worktree', async () => {
    const repoPath = createTestRepo('git-ws-replace')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const initialPath = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.createWorktree(repo, 'replace-ws', 'replace-branch', true)
      }, repoPath)

      const replacedPath = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.createWorktree(
          repo,
          'replace-ws',
          'replace-branch',
          true,
          undefined,
          true,
        )
      }, repoPath)

      expect(normalizeMacPath(replacedPath as string)).toBe(normalizeMacPath(initialPath as string))

      const realWorktree = realpathSync(replacedPath as string)
      const gitPointer = readFileSync(join(realWorktree, '.git'), 'utf8')
      expect(gitPointer).toContain('/.git/worktrees/')

      execSync(`git -C "${realWorktree}" status --short`, { stdio: 'pipe' })

      const commonDir = execSync('git rev-parse --git-common-dir', {
        cwd: realWorktree,
        encoding: 'utf8',
      }).trim()
      expect(normalizeMacPath(resolve(realWorktree, commonDir))).toBe(
        normalizeMacPath(join(realRepo, '.git')),
      )

      const worktreeList = execSync('git worktree list --porcelain', {
        cwd: realRepo,
        encoding: 'utf8',
      })
      const matchingEntries = worktreeList
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .filter((line) => normalizeMacPath(line.slice('worktree '.length)) === normalizeMacPath(realWorktree))

      expect(matchingEntries).toHaveLength(1)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('workspace shows in sidebar and becomes active', async () => {
    const repoPath = createTestRepo('sidebar-ws')
    const { app, window } = await launchApp()

    try {
      // Clear state, then add project and workspace
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })

        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'sidebar-project', repoPath: repo })

        const worktreePath = await (window as any).api.git.createWorktree(repo, 'sidebar-ws', 'ws-branch', true)
        const wsId = crypto.randomUUID()
        store.addWorkspace({
          id: wsId,
          name: 'sidebar-ws',
          branch: 'ws-branch',
          worktreePath,
          projectId,
        })
      }, repoPath)

      await window.waitForTimeout(500)

      // The project header should be in the sidebar
      const projectHeader = window.locator('[class*="projectHeader"]', { hasText: 'sidebar-project' }).first()
      await expect(projectHeader).toBeVisible()

      // Projects are expanded by default — no click needed

      // Workspace should be visible (sidebar shows branch name)
      const workspaceItem = window.locator('[class*="workspaceItem"]', { hasText: 'ws-branch' })
      await expect(workspaceItem).toBeVisible()

      // It should be active (since addWorkspace auto-sets activeWorkspaceId)
      const activeClass = await workspaceItem.getAttribute('class')
      expect(activeClass).toContain('active')

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/sidebar-workspace-active.png'),
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('git status detects modified files', async () => {
    const repoPath = createTestRepo('git-status')
    const { app, window } = await launchApp()

    try {
      // Create worktree and modify a file
      const worktreePath = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.createWorktree(repo, 'status-ws', 'status-branch', true)
      }, repoPath)

      // Write a change to the worktree (resolve symlinks for macOS /tmp -> /private/tmp)
      const realWt = realpathSync(worktreePath as string)
      writeFileSync(join(realWt, 'README.md'), '# Modified!\n')

      // Check git status via IPC
      const statuses = await window.evaluate(async (wt: string) => {
        return await (window as any).api.git.getStatus(wt)
      }, worktreePath as string)

      expect(statuses.length).toBeGreaterThan(0)
      // Look for README.md change — path may have various formats
      const readmeStatus = statuses.find((s: any) => s.path.includes('README'))
      if (readmeStatus) {
        expect(['modified', 'untracked', 'added']).toContain(readmeStatus.status)
      }
      // At minimum, there should be at least one change detected
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('linked t3 project path anchors to the primary repo and shows main changes', async () => {
    const repoPath = createTestRepo('linked-t3-anchor')
    const realRepo = realpathSync(repoPath)
    const repoName = realRepo.split('/').pop()!
    const t3Root = join(homedir(), '.t3', 'worktrees', repoName)
    const linkedPath = join(t3Root, 'feature-sidebar')
    mkdirSync(t3Root, { recursive: true })
    execSync(`git worktree add -b feature-sidebar "${linkedPath}"`, { cwd: realRepo })
    const realLinkedPath = realpathSync(linkedPath)

    const { app, window } = await launchApp()

    try {
      await window.evaluate(async ({ selectedPath }: { selectedPath: string }) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const repoPath = await (window as any).api.git.getProjectRepoAnchor(selectedPath)
        store.addProject({
          id: crypto.randomUUID(),
          name: 'linked-project',
          repoPath,
        })
      }, { selectedPath: realLinkedPath })

      await window.waitForFunction(() => {
        const store = (window as any).__store.getState()
        const project = store.projects[0]
        if (!project) return false
        const branches = store.workspaces.map((w: any) => w.branch)
        return branches.includes('main') && branches.includes('feature-sidebar')
      })

      const state = await window.evaluate(() => {
        const store = (window as any).__store.getState()
        return {
          repoPath: store.projects[0]?.repoPath ?? '',
          branches: store.workspaces.map((w: any) => w.branch),
        }
      })

      expect(state.repoPath.replace('/private', '')).toBe(realRepo.replace('/private', ''))
      expect(state.branches).toEqual(expect.arrayContaining(['main', 'feature-sidebar']))

      writeFileSync(join(realRepo, 'README.md'), '# main changed\n')

      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        const mainWorkspace = store.workspaces.find((w: any) => w.branch === 'main')
        if (!mainWorkspace) throw new Error('main workspace missing')
        store.setActiveWorkspace(mainWorkspace.id)
      })

      await window.locator('button', { hasText: 'Changes' }).click()
      await window.waitForTimeout(1200)

      const readmeChange = window.locator('[class*="changePath"]', { hasText: 'README.md' })
      await expect(readmeChange).toBeVisible({ timeout: 5000 })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('git branches lists available branches', async () => {
    const repoPath = createTestRepo('git-branches')
    const { app, window } = await launchApp()

    try {
      const branches = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.getBranches(repo)
      }, repoPath)

      expect(branches).toContain('main')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('git file diff returns diff text for changed file', async () => {
    const repoPath = createTestRepo('git-diff')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.createWorktree(repo, 'diff-ws', 'diff-branch', true)
      }, repoPath)

      // Modify a file in the worktree
      writeFileSync(join(worktreePath as string, 'README.md'), '# Changed Content\nNew line here\n')

      // Get file diff
      const diffText = await window.evaluate(async (wt: string) => {
        return await (window as any).api.git.getFileDiff(wt, 'README.md')
      }, worktreePath as string)

      expect(diffText).toBeTruthy()
      expect(diffText).toContain('Changed Content')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('right panel mode toggle stays equal-width without overflow', async () => {
    const { app, window } = await launchApp()

    try {
      const toggle = window.getByTestId('right-panel-mode-toggle')
      const filesBtn = window.getByTestId('right-panel-mode-files')
      const changesBtn = window.getByTestId('right-panel-mode-changes')
      const graphBtn = window.getByTestId('right-panel-mode-graph')

      await expect(toggle).toBeVisible()
      await expect(filesBtn).toBeVisible()
      await expect(changesBtn).toBeVisible()
      await expect(graphBtn).toBeVisible()

      const filesBtnClass = await filesBtn.getAttribute('class')
      expect(filesBtnClass).toContain('active')

      await changesBtn.click()
      await window.waitForTimeout(300)
      const changesBtnClass = await changesBtn.getAttribute('class')
      expect(changesBtnClass).toContain('active')

      const toggleBox = await toggle.boundingBox()
      const filesBox = await filesBtn.boundingBox()
      const changesBox = await changesBtn.boundingBox()
      const graphBox = await graphBtn.boundingBox()

      expect(toggleBox).toBeTruthy()
      expect(filesBox).toBeTruthy()
      expect(changesBox).toBeTruthy()
      expect(graphBox).toBeTruthy()

      if (!toggleBox || !filesBox || !changesBox || !graphBox) throw new Error('Missing right panel toggle bounds')

      const widths = [filesBox.width, changesBox.width, graphBox.width]
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2)
      expect(filesBox.x).toBeGreaterThanOrEqual(toggleBox.x - 1)
      expect(graphBox.x + graphBox.width).toBeLessThanOrEqual(toggleBox.x + toggleBox.width + 1)

      const hasOverflow = await window.evaluate(() => {
        const ids = [
          'right-panel-mode-toggle',
          'right-panel-mode-files',
          'right-panel-mode-changes',
          'right-panel-mode-graph',
        ]
        return ids.some((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
          return !el || el.scrollWidth > el.clientWidth + 1
        })
      })
      expect(hasOverflow).toBe(false)

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/right-panel-toggle.png'),
      })
    } finally {
      await app.close()
    }
  })

  test('empty state shows when no workspace selected', async () => {
    const { app, window } = await launchApp()

    try {
      // Clear any persisted state
      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
      })
      await window.waitForTimeout(500)

      // With no workspace, right panel should show empty state
      const emptyText = window.locator('text=No workspace selected')
      await expect(emptyText).toBeVisible({ timeout: 5000 })

      // Welcome message in center
      const welcome = window.locator('[class*="welcomeLogo"]')
      await expect(welcome).toHaveText('constellagent')
    } finally {
      await app.close()
    }
  })

  test('multiple workspaces can be switched via sidebar', async () => {
    const repoPath = createTestRepo('multi-ws')
    const { app, window } = await launchApp()

    try {
      // Clear state, create project with two workspaces
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })

        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'multi-project', repoPath: repo })

        // Workspace 1
        const wt1 = await (window as any).api.git.createWorktree(repo, 'ws-alpha', 'branch-alpha', true)
        const ws1Id = crypto.randomUUID()
        store.addWorkspace({
          id: ws1Id, name: 'ws-alpha', branch: 'branch-alpha', worktreePath: wt1, projectId,
        })

        // Workspace 2
        const wt2 = await (window as any).api.git.createWorktree(repo, 'ws-beta', 'branch-beta', true)
        const ws2Id = crypto.randomUUID()
        store.addWorkspace({
          id: ws2Id, name: 'ws-beta', branch: 'branch-beta', worktreePath: wt2, projectId,
        })
      }, repoPath)

      await window.waitForTimeout(500)

      // Projects are expanded by default — no click needed

      // Both workspaces should be visible (sidebar shows branch names)
      const wsAlpha = window.locator('[class*="workspaceItem"]', { hasText: 'branch-alpha' })
      const wsBeta = window.locator('[class*="workspaceItem"]', { hasText: 'branch-beta' })
      await expect(wsAlpha).toBeVisible()
      await expect(wsBeta).toBeVisible()

      // ws-beta should be active (it was added last)
      const betaClass = await wsBeta.getAttribute('class')
      expect(betaClass).toContain('active')

      // Click ws-alpha to switch
      await wsAlpha.click()
      await window.waitForTimeout(300)

      const alphaClass = await wsAlpha.getAttribute('class')
      expect(alphaClass).toContain('active')

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/sidebar-multi-workspace.png'),
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('removing the active workspace restores a tab from the replacement workspace', async () => {
    const repoPath = createTestRepo('remove-active-ws')
    const { app, window } = await launchApp()

    try {
      const result = await window.evaluate(async (repo: string) => {
        const getState = (window as any).__store.getState
        const store = getState()
        store.hydrateState({ projects: [], workspaces: [] })

        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'sidebar-project', repoPath: repo })

        const worktreeA = await (window as any).api.git.createWorktree(repo, 'remove-a', 'branch-a', true)
        const workspaceAId = crypto.randomUUID()
        store.addWorkspace({
          id: workspaceAId,
          name: 'remove-a',
          branch: 'branch-a',
          worktreePath: worktreeA,
          projectId,
        })
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId: workspaceAId,
          type: 'file',
          filePath: `${worktreeA}/README.md`,
        })
        const tabAId = getState().activeTabId

        const worktreeB = await (window as any).api.git.createWorktree(repo, 'remove-b', 'branch-b', true)
        const workspaceBId = crypto.randomUUID()
        store.addWorkspace({
          id: workspaceBId,
          name: 'remove-b',
          branch: 'branch-b',
          worktreePath: worktreeB,
          projectId,
        })
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId: workspaceBId,
          type: 'file',
          filePath: `${worktreeB}/README.md`,
        })

        store.setActiveWorkspace(workspaceAId)
        store.setActiveWorkspace(workspaceBId)
        const tabBId = getState().activeTabId

        store.removeWorkspace(workspaceBId)

        return {
          activeWorkspaceId: getState().activeWorkspaceId,
          activeTabId: getState().activeTabId,
          workspaceAId,
          tabAId,
          tabBId,
          activeTabWorkspaceId: getState().tabs.find((tab: { id: string; workspaceId: string }) => (
            tab.id === getState().activeTabId
          ))?.workspaceId ?? null,
          tabs: getState().tabs.map((tab: { id: string; workspaceId: string }) => ({
            id: tab.id,
            workspaceId: tab.workspaceId,
          })),
        }
      }, repoPath)

      expect(result.activeWorkspaceId).not.toBeNull()
      expect(result.activeTabWorkspaceId).toBe(result.activeWorkspaceId)
      expect(result.activeTabId).not.toBe(result.tabBId)
      if (result.activeWorkspaceId === result.workspaceAId) {
        expect(result.activeTabId).toBe(result.tabAId)
      }
      expect(result.tabs.every((tab: { id: string }) => tab.id !== result.tabBId)).toBe(true)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
