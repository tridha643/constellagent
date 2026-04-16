import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appPath],
    env: { ...process.env, CI_TEST: '1', CONSTELLAGENT_PI_E2E_STUB: '1' },
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

async function setupWorkspaceWithPiThread(window: Page, repoPath: string) {
  return await window.evaluate(async (repo: string) => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })
    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })
    const worktreePath = await (window as unknown as { api: { git: { createWorktree: (...a: unknown[]) => Promise<string> } } }).api.git.createWorktree(
      repo,
      'test-ws',
      'test-branch',
      true,
    )
    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId,
      name: 'test-ws',
      branch: 'test-branch',
      worktreePath,
      projectId,
    })
    store.addTab({
      id: crypto.randomUUID(),
      workspaceId: wsId,
      type: 'pi-thread',
      title: 'PI Chat',
    })
    return { wsId, worktreePath }
  }, repoPath)
}

test.describe('PI thread tab', () => {
  test('pi-thread tab mounts Pi SDK panel with timeline shell', async () => {
    const repoPath = createTestRepo('pi-thread')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithPiThread(window, repoPath)
      await window.waitForTimeout(3000)

      const shell = window.locator('[class*="shell"]').filter({ hasText: 'PI Chat' }).first()
      await expect(shell).toBeVisible({ timeout: 20000 })

      await expect(window.getByTestId('timeline-pane')).toBeVisible()
      await expect(window.getByTestId('transcript')).toBeVisible()
      await expect(window.getByTestId('composer')).toBeVisible()

      const sendText = `e2e-pi-send-${Date.now()}`
      await window.getByTestId('composer').fill(sendText)
      await window.getByTestId('send').click()
      await expect(window.getByTestId('transcript')).toContainText(sendText, { timeout: 15000 })
    } finally {
      await app.close()
    }
  })

  test('Shift+Tab in composer cycles reasoning badge', async () => {
    const repoPath = createTestRepo('pi-reasoning-hotkey')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithPiThread(window, repoPath)
      await window.waitForTimeout(3000)

      const composer = window.getByTestId('composer')
      await expect(composer).toBeVisible({ timeout: 20000 })
      await composer.click()
      await window.keyboard.press('Shift+Tab')

      const badge = window.getByTestId('pi-thinking-badge')
      await expect(badge).toBeVisible({ timeout: 15000 })
      await expect(badge).toHaveText(/^(low|medium|high|xhigh)$/)
    } finally {
      await app.close()
    }
  })
})
