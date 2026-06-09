import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve, join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

function createUserDataPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), `constellagent-${name}-`)), 'user-data')
}

async function launchApp(userDataPath?: string): Promise<{ app: ElectronApplication; window: Page }> {
  const env = { ...process.env, CI_TEST: '1' } as Record<string, string>
  if (userDataPath) env.CONSTELLAGENT_USER_DATA_PATH = userDataPath
  const app = await electron.launch({ args: [appPath], env })
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

async function setupWorkspace(window: Page, repoPath: string) {
  return await window.evaluate(async (repo: string) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })

    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

    const worktreePath = await (window as any).api.git.createWorktree(repo, 'ws-regression', 'branch-regression', true)
    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId,
      name: 'ws-regression',
      branch: 'branch-regression',
      worktreePath,
      projectId,
    })

    return { wsId, worktreePath, projectId }
  }, repoPath)
}

test.describe('Git graph removal regression', () => {
  test('preload git API no longer exposes getLog or getCommitDiff', async () => {
    const { app, window } = await launchApp()

    try {
      const gitApi = await window.evaluate(() => {
        const git = (window as any).api.git as Record<string, unknown>
        return {
          hasGetLog: typeof git.getLog === 'function',
          hasGetCommitDiff: typeof git.getCommitDiff === 'function',
        }
      })

      expect(gitApi.hasGetLog).toBe(false)
      expect(gitApi.hasGetCommitDiff).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('right sidebar shows Files and Changes only in the mode toggle', async () => {
    const { app, window } = await launchApp()

    try {
      await expect(window.getByTestId('right-panel-mode-files')).toBeVisible()
      await expect(window.getByTestId('right-panel-mode-changes')).toBeVisible()
      await expect(window.getByTestId('right-panel-mode-graph')).toHaveCount(0)
      await expect(window.locator('button', { hasText: 'Git' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('Meta+Alt+g is inert after git panel removal', async () => {
    const repoPath = createTestRepo('graph-shortcut-regression')
    const { app, window } = await launchApp()

    try {
      await setupWorkspace(window, repoPath)
      await window.waitForTimeout(800)

      const before = await window.evaluate(() => {
        const { sidePanels } = (window as any).__store.getState()
        return {
          activePanel: sidePanels.right.activePanel,
          panelOrder: sidePanels.right.panelOrder,
        }
      })

      await window.keyboard.press('Meta+Alt+g')
      await window.waitForTimeout(300)

      const after = await window.evaluate(() => {
        const { sidePanels, tabs } = (window as any).__store.getState()
        return {
          activePanel: sidePanels.right.activePanel,
          panelOrder: sidePanels.right.panelOrder,
          tabCount: tabs.length,
        }
      })

      expect(after.panelOrder).not.toContain('graph')
      expect(after.activePanel).toBe(before.activePanel)
      expect(after.tabCount).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('cold boot migrates persisted graph panel layout without crashing', async () => {
    const repoPath = createTestRepo('graph-layout-regression')
    const userDataPath = createUserDataPath('graph-layout-regression')
    const stateFile = join(userDataPath, 'constellagent-state.json')
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(stateFile, JSON.stringify({
      projects: [{ id: 'legacy-project', name: 'legacy-project', repoPath }],
      workspaces: [],
      tabs: [],
      rightPanelOpen: true,
      rightPanelMode: 'graph',
      sidePanels: {
        left: { open: true, activePanel: 'project', panelOrder: ['project'] },
        right: {
          open: true,
          activePanel: 'graph',
          panelOrder: ['files', 'changes', 'graph', 'browser', 'sideChat'],
        },
      },
    }, null, 2))

    const { app, window } = await launchApp(userDataPath)

    try {
      await window.waitForTimeout(1200)

      const sidePanels = await window.evaluate(() => (window as any).__store.getState().sidePanels)
      expect(sidePanels.right.panelOrder).toEqual(['files', 'changes', 'browser', 'sideChat'])
      expect(sidePanels.right.activePanel).toBe('files')
      await expect(window.getByTestId('right-panel-mode-graph')).toHaveCount(0)
      await expect(window.getByTestId('right-panel')).toBeVisible()
    } finally {
      await app.close()
      rmSync(userDataPath, { recursive: true, force: true })
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  test('cold boot migrates legacy commit diff tabs to working-tree diff tabs', async () => {
    const repoPath = createTestRepo('commit-diff-regression')
    const userDataPath = createUserDataPath('commit-diff-regression')
    const workspaceId = 'ws-legacy-commit-diff'
    const stateFile = join(userDataPath, 'constellagent-state.json')
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(stateFile, JSON.stringify({
      projects: [{ id: 'project-legacy', name: 'project-legacy', repoPath }],
      workspaces: [{
        id: workspaceId,
        name: 'main',
        branch: 'main',
        worktreePath: repoPath,
        projectId: 'project-legacy',
      }],
      tabs: [{
        id: 'diff-legacy-commit',
        workspaceId,
        type: 'diff',
        commitHash: 'deadbeef',
        commitMessage: 'legacy commit diff',
      }],
      activeWorkspaceId: workspaceId,
      activeTabId: 'diff-legacy-commit',
      sidePanels: {
        left: { open: true, activePanel: 'project', panelOrder: ['project'] },
        right: { open: true, activePanel: 'changes', panelOrder: ['files', 'changes', 'browser', 'sideChat'] },
      },
    }, null, 2))

    const { app, window } = await launchApp(userDataPath)

    try {
      await window.waitForTimeout(1500)

      const tab = await window.evaluate(() => {
        const state = (window as any).__store.getState()
        return state.tabs.find((entry: { id: string }) => entry.id === 'diff-legacy-commit')
      })

      expect(tab).toEqual({
        id: 'diff-legacy-commit',
        workspaceId,
        type: 'diff',
      })
      expect(tab?.commitHash).toBeUndefined()
      expect(tab?.commitMessage).toBeUndefined()
    } finally {
      await app.close()
      rmSync(userDataPath, { recursive: true, force: true })
      rmSync(repoPath, { recursive: true, force: true })
    }
  })
})
