import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

type SidebarProjectSetup = {
  name: string
  repoPath: string
  workspaces: Array<{ name: string; branch: string }>
}

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

async function setupWorkspaceWithTerminal(window: Page, repoPath: string) {
  return await window.evaluate(async (repo: string) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })

    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

    const worktreePath = await (window as any).api.git.createWorktree(repo, 'ws-1', 'branch-1', true)

    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId, name: 'ws-1', branch: 'branch-1', worktreePath, projectId,
    })

    const ptyId = await (window as any).api.pty.create(worktreePath)
    store.addTab({
      id: crypto.randomUUID(), workspaceId: wsId, type: 'terminal', title: 'Terminal 1', ptyId,
    })

    return { ptyId, wsId, worktreePath, projectId }
  }, repoPath)
}

async function setupSidebarProjects(window: Page, projects: SidebarProjectSetup[]) {
  return await window.evaluate(async (input: SidebarProjectSetup[]) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })

    const result: Array<{
      projectId: string
      name: string
      workspaces: Array<{ id: string; name: string; branch: string; worktreePath: string }>
    }> = []

    for (const project of input) {
      const projectId = crypto.randomUUID()
      store.addProject({ id: projectId, name: project.name, repoPath: project.repoPath })

      const createdWorkspaces: Array<{ id: string; name: string; branch: string; worktreePath: string }> = []
      for (const workspace of project.workspaces) {
        const worktreePath = await (window as any).api.git.createWorktree(
          project.repoPath,
          workspace.name,
          workspace.branch,
          true,
        )
        const workspaceId = crypto.randomUUID()
        store.addWorkspace({
          id: workspaceId,
          name: workspace.name,
          branch: workspace.branch,
          worktreePath,
          projectId,
        })
        createdWorkspaces.push({
          id: workspaceId,
          name: workspace.name,
          branch: workspace.branch,
          worktreePath,
        })
      }

      result.push({ projectId, name: project.name, workspaces: createdWorkspaces })
    }

    return result
  }, projects)
}

test.describe('Keyboard shortcuts', () => {
  test('Cmd+T creates new terminal tab', async () => {
    const repoPath = createTestRepo('shortcut-t')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithTerminal(window, repoPath)
      await window.waitForTimeout(2000)

      const tabsBefore = await window.locator('[class*="tabTitle"]').count()
      expect(tabsBefore).toBe(1)

      await window.keyboard.press('Meta+t')
      await window.waitForTimeout(2000)

      const tabsAfter = await window.locator('[class*="tabTitle"]').count()
      expect(tabsAfter).toBe(2)
    } finally {
      await app.close()
    }
  })

  test('Cmd+1/Cmd+2 switches projects by visible sidebar order and restores last active workspace', async () => {
    const repoA = createTestRepo('shortcut-project-a')
    const repoB = createTestRepo('shortcut-project-b')
    const { app, window } = await launchApp()

    try {
      const setup = await setupSidebarProjects(window, [
        {
          name: 'project-alpha',
          repoPath: repoA,
          workspaces: [
            { name: 'ws-a1', branch: 'branch-a1' },
            { name: 'ws-a2', branch: 'branch-a2' },
          ],
        },
        {
          name: 'project-beta',
          repoPath: repoB,
          workspaces: [
            { name: 'ws-b1', branch: 'branch-b1' },
          ],
        },
      ])
      await window.waitForTimeout(1500)

      const [projectAlpha, projectBeta] = setup
      const alphaSecondWorkspaceId = projectAlpha.workspaces[1].id
      const betaWorkspaceId = projectBeta.workspaces[0].id

      await window.evaluate(({ alphaSecondWorkspaceId, betaWorkspaceId }) => {
        const store = (window as any).__store.getState()
        store.setActiveWorkspace(alphaSecondWorkspaceId)
        store.setActiveWorkspace(betaWorkspaceId)
      }, { alphaSecondWorkspaceId, betaWorkspaceId })
      await window.waitForTimeout(300)

      await window.keyboard.press('Meta+1')
      await window.waitForTimeout(500)

      let activeBranch = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.workspaces.find((w: any) => w.id === s.activeWorkspaceId)?.branch
      })
      expect(activeBranch).toBe('branch-a2')

      await window.keyboard.press('Meta+2')
      await window.waitForTimeout(500)

      activeBranch = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.workspaces.find((w: any) => w.id === s.activeWorkspaceId)?.branch
      })
      expect(activeBranch).toBe('branch-b1')
    } finally {
      await app.close()
    }
  })

  // Skipped: Playwright + Electron often omit `metaKey` on the digit keydown when xterm has focus,
  // so the shortcut is not assertable here; ⌘1–9 from terminal is verified manually (global handler + xterm hook).
  test.skip('Cmd+1 switches projects while terminal is focused', async () => {
    const repoA = createTestRepo('shortcut-typing-a')
    const repoB = createTestRepo('shortcut-typing-b')
    const { app, window } = await launchApp()

    try {
      const setup = await setupSidebarProjects(window, [
        {
          name: 'project-alpha',
          repoPath: repoA,
          workspaces: [{ name: 'ws-a1', branch: 'branch-a1' }],
        },
        {
          name: 'project-beta',
          repoPath: repoB,
          workspaces: [{ name: 'ws-b1', branch: 'branch-b1' }],
        },
      ])
      await window.waitForTimeout(1500)

      const activeWorkspace = setup[1].workspaces[0]
      await window.evaluate(async ({ workspaceId, worktreePath }) => {
        const store = (window as any).__store.getState()
        store.setActiveWorkspace(workspaceId)
        const ptyId = await (window as any).api.pty.create(worktreePath)
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId,
          type: 'terminal',
          title: 'Terminal 1',
          ptyId,
        })
      }, {
        workspaceId: activeWorkspace.id,
        worktreePath: activeWorkspace.worktreePath,
      })
      await window.waitForTimeout(1000)

      const terminal = window.locator('[class*="terminalInner"]').first()
      await terminal.click()
      await window.waitForTimeout(300)

      await window.keyboard.type('hello')
      await window.keyboard.press('Meta+1')
      await window.waitForTimeout(500)

      const activeBranch = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.workspaces.find((w: any) => w.id === s.activeWorkspaceId)?.branch
      })
      expect(activeBranch).toBe('branch-a1')
    } finally {
      await app.close()
    }
  })

  test('Cmd+click inactive terminal tab splits like Cmd+D', async () => {
    const repoPath = createTestRepo('shortcut-cmd-click-split')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithTerminal(window, repoPath)
      await window.waitForTimeout(2000)

      await window.keyboard.press('Meta+t')
      await window.waitForTimeout(2000)

      expect(await window.locator('[class*="tabTitle"]').count()).toBe(2)

      const tab1Title = window.locator('[class*="tabTitle"]', { hasText: 'Terminal 1' })
      await tab1Title.click({ modifiers: ['Meta'] })
      await window.waitForTimeout(2500)

      const hasSplit = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.type === 'terminal' && t.title === 'Terminal 1')
        return !!(tab && tab.splitRoot)
      })
      expect(hasSplit).toBe(true)

      const activeIsTab1 = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
        return tab?.type === 'terminal' && tab?.title === 'Terminal 1'
      })
      expect(activeIsTab1).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('Cmd+W closes active tab', async () => {
    const repoPath = createTestRepo('shortcut-w')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithTerminal(window, repoPath)
      await window.waitForTimeout(2000)

      await window.keyboard.press('Meta+t')
      await window.waitForTimeout(2000)
      expect(await window.locator('[class*="tabTitle"]').count()).toBe(2)

      await window.keyboard.press('Meta+w')
      await window.waitForTimeout(1000)

      expect(await window.locator('[class*="tabTitle"]').count()).toBe(1)
    } finally {
      await app.close()
    }
  })

  test('Cmd+B toggles sidebar', async () => {
    const { app, window } = await launchApp()

    try {
      const sidebar = window.locator('[class*="sidebar"]').first()
      await expect(sidebar).toBeVisible()

      await window.keyboard.press('Meta+b')
      await window.waitForTimeout(500)

      await expect(sidebar).not.toBeVisible()

      await window.keyboard.press('Meta+b')
      await window.waitForTimeout(500)

      await expect(sidebar).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('Cmd+Option+B toggles right panel', async () => {
    const { app, window } = await launchApp()

    try {
      const rightPanel = window.getByTestId('right-panel')
      await expect(rightPanel).toBeVisible()

      await window.keyboard.press('Meta+Alt+b')
      await window.waitForTimeout(500)
      await expect(rightPanel).not.toBeVisible()

      await window.keyboard.press('Meta+Alt+b')
      await window.waitForTimeout(500)
      await expect(rightPanel).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('Cmd+Shift+[ and Cmd+Shift+] cycle tabs', async () => {
    const repoPath = createTestRepo('shortcut-brackets')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithTerminal(window, repoPath)
      await window.waitForTimeout(2000)

      await window.keyboard.press('Meta+t')
      await window.waitForTimeout(2000)

      let active = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.tabs.find((t: any) => t.id === s.activeTabId)?.title
      })
      expect(active).toBe('Terminal 2')

      await window.keyboard.press('Meta+Shift+[')
      await window.waitForTimeout(500)

      active = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.tabs.find((t: any) => t.id === s.activeTabId)?.title
      })
      expect(active).toBe('Terminal 1')

      await window.keyboard.press('Meta+Shift+]')
      await window.waitForTimeout(500)

      active = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.tabs.find((t: any) => t.id === s.activeTabId)?.title
      })
      expect(active).toBe('Terminal 2')
    } finally {
      await app.close()
    }
  })

  test('Cmd+[ and Cmd+] cycle workspaces within the active project only', async () => {
    const repoA = createTestRepo('shortcut-workspace-a')
    const repoB = createTestRepo('shortcut-workspace-b')
    const { app, window } = await launchApp()

    try {
      const setup = await setupSidebarProjects(window, [
        {
          name: 'project-alpha',
          repoPath: repoA,
          workspaces: [
            { name: 'ws-a1', branch: 'branch-a1' },
            { name: 'ws-a2', branch: 'branch-a2' },
          ],
        },
        {
          name: 'project-beta',
          repoPath: repoB,
          workspaces: [
            { name: 'ws-b1', branch: 'branch-b1' },
          ],
        },
      ])
      await window.waitForTimeout(1500)

      const projectAlpha = setup[0]
      const alphaSecondId = projectAlpha.workspaces[1].id

      await window.evaluate((workspaceId: string) => {
        const store = (window as any).__store.getState()
        store.setActiveWorkspace(workspaceId)
      }, alphaSecondId)
      await window.waitForTimeout(300)

      await window.keyboard.press('Meta+[')
      await window.waitForTimeout(500)

      let activeBranch = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.workspaces.find((w: any) => w.id === s.activeWorkspaceId)?.branch
      })
      expect(activeBranch).toBe('branch-a1')

      await window.keyboard.press('Meta+]')
      await window.waitForTimeout(500)

      activeBranch = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.workspaces.find((w: any) => w.id === s.activeWorkspaceId)?.branch
      })
      expect(activeBranch).toBe('branch-a2')

      const betaBranchWsId = setup[1].workspaces[0].id
      await window.evaluate((workspaceId: string) => {
        const store = (window as any).__store.getState()
        store.setActiveWorkspace(workspaceId)
      }, betaBranchWsId)
      await window.waitForTimeout(300)

      await window.keyboard.press('Meta+[')
      await window.waitForTimeout(500)

      activeBranch = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.workspaces.find((w: any) => w.id === s.activeWorkspaceId)?.branch
      })
      // Git reconcile adds the primary repo checkout (usually `main`) as a second workspace in the same project.
      expect(activeBranch).toBe('main')

      await window.keyboard.press('Meta+]')
      await window.waitForTimeout(500)

      activeBranch = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.workspaces.find((w: any) => w.id === s.activeWorkspaceId)?.branch
      })
      expect(activeBranch).toBe('branch-b1')
    } finally {
      await app.close()
    }
  })

  test('Cmd+J focuses terminal or creates one', async () => {
    const repoPath = createTestRepo('shortcut-j')
    const { app, window } = await launchApp()

    try {
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })

        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

        const worktreePath = await (window as any).api.git.createWorktree(repo, 'ws-j', 'branch-j', true)

        store.addWorkspace({
          id: crypto.randomUUID(), name: 'ws-j', branch: 'branch-j', worktreePath, projectId,
        })
      }, repoPath)
      await window.waitForTimeout(1000)

      expect(await window.locator('[class*="tabTitle"]').count()).toBe(0)

      await window.keyboard.press('Meta+j')
      await window.waitForTimeout(2000)

      expect(await window.locator('[class*="tabTitle"]').count()).toBe(1)
    } finally {
      await app.close()
    }
  })

  test('Cmd+Option+G opens the Git panel without opening a diff tab', async () => {
    const repoPath = createTestRepo('shortcut-alt-g')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithTerminal(window, repoPath)
      await window.waitForTimeout(2000)

      expect(await window.locator('[class*="tabTitle"]').count()).toBe(1)

      await window.keyboard.press('Meta+Alt+g')
      await window.waitForTimeout(1000)

      const gitBtn = window.locator('button', { hasText: 'Git' })
      await expect(gitBtn).toHaveClass(/active/)
      expect(await window.locator('[class*="tabTitle"]').count()).toBe(1)
      await expect(window.locator('[class*="diffToolbar"]')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('Shift+Tab keeps focus in terminal', async () => {
    const repoPath = createTestRepo('shortcut-shifttab')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithTerminal(window, repoPath)
      await window.waitForTimeout(3000)

      const termInner = window.locator('[class*="terminalInner"]').first()
      await termInner.click()
      await window.waitForTimeout(500)

      expect(await window.evaluate(() =>
        !!document.activeElement?.closest('[class*="terminalInner"]')
      )).toBe(true)

      await window.keyboard.press('Shift+Tab')
      await window.waitForTimeout(500)

      expect(await window.evaluate(() =>
        !!document.activeElement?.closest('[class*="terminalInner"]')
      )).toBe(true)
    } finally {
      await app.close()
    }
  })
})
