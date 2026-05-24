import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appPath],
    env: { ...process.env, CI_TEST: '1' },
  })
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

async function setupWorkspace(window: Page, repoPath: string): Promise<{ wsId: string }> {
  return await window.evaluate(async (repo: string) => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })
    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })
    const worktreePath = await (
      window as unknown as { api: { git: { createWorktree: (...a: unknown[]) => Promise<string> } } }
    ).api.git.createWorktree(repo, 'test-ws', 'test-branch', true)
    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId,
      name: 'test-ws',
      branch: 'test-branch',
      projectId,
      worktreePath,
    })
    store.setActiveWorkspace(wsId)
    return { wsId }
  }, repoPath)
}

test.describe('Linear issue Conductor launch', () => {
  test('opens Conductor tab and closes Linear panel when launch target is conductor', async () => {
    const { app, window } = await launchApp()
    try {
      const repoPath = createTestRepo('linear-conductor-launch')
      await setupWorkspace(window, repoPath)

      await window.evaluate(() => {
        const store = (window as unknown as { __store: { getState: () => any; setState: (p: unknown) => void } }).__store
        store.getState().updateSettings({
          linearIssueLaunchTarget: 'conductor',
          linearIssueConductorUseDefaults: true,
          conductorDefaultProvider: 'cursor',
          conductorCursorApiKey: 'test-key-for-e2e',
          linearIssueClosePanelOnLaunch: true,
        })
        store.setState({ linearPanelOpen: true })
      })

      const issue = {
        id: 'e2e-linear-conductor-issue',
        identifier: 'E2E-99',
        title: 'Conductor launch test',
        url: 'https://linear.app/e2e/issue/e2e-linear-conductor-issue',
        state: { name: 'Backlog', type: 'backlog' },
        team: { id: 'e2e-team', key: 'E2E', name: 'E2E' },
      }

      await window.evaluate(async (row) => {
        await (window as unknown as { __store: { getState: () => any } }).__store
          .getState()
          .startLinearIssueAgentSession(row)
      }, issue)

      await window.waitForTimeout(2000)

      const result = await window.evaluate(() => {
        const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
        const conductorTabs = store.tabs.filter(
          (t: { type: string; workspaceId: string }) =>
            t.type === 'conductor' && t.workspaceId === store.activeWorkspaceId,
        )
        return {
          linearPanelOpen: store.linearPanelOpen,
          conductorTabCount: conductorTabs.length,
          hasSessionBinding: conductorTabs.some(
            (t: { agentSessionId?: string }) => typeof t.agentSessionId === 'string',
          ),
          workspaceName: store.workspaces.find((w: { id: string }) => w.id === store.activeWorkspaceId)
            ?.name,
        }
      })

      expect(result.conductorTabCount).toBeGreaterThan(0)
      expect(result.hasSessionBinding).toBe(true)
      expect(result.linearPanelOpen).toBe(false)
      expect(result.workspaceName).toContain('E2E-99')
    } finally {
      await app.close()
    }
  })
})
