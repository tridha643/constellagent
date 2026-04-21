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

async function setupWorkspaceWithTwoPiThreads(
  window: Page,
  repoPath: string,
): Promise<{
  wsId: string
  worktreePath: string
  tabA: string
  tabB: string
  sessionA?: string
  sessionB?: string
  setupError?: string
}> {
  return await window.evaluate(async (repo: string) => {
    const getState = (window as unknown as { __store: { getState: () => any } }).__store.getState
    try {
      const store = getState()
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
      await store.createPiThreadForActiveWorkspace()
      await store.createPiThreadForActiveWorkspace()
      const tabs = getState().tabs.filter((t: { type: string }) => t.type === 'pi-thread')
      const a = tabs[tabs.length - 2]
      const b = tabs[tabs.length - 1]
      return {
        wsId,
        worktreePath,
        tabA: a.id as string,
        tabB: b.id as string,
        sessionA: a.piSessionId as string | undefined,
        sessionB: b.piSessionId as string | undefined,
      }
    } catch (e) {
      return {
        wsId: '',
        worktreePath: '',
        tabA: '',
        tabB: '',
        setupError: e instanceof Error ? e.message : String(e),
      }
    }
  }, repoPath)
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

async function setupTwoWorkspacesWithPiThreads(window: Page, repoPath: string) {
  return await window.evaluate(async (repo: string) => {
    const getState = (window as unknown as { __store: { getState: () => any } }).__store.getState
    const store = getState()
    store.hydrateState({ projects: [], workspaces: [] })
    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

    const worktreeA = await (window as unknown as { api: { git: { createWorktree: (...a: unknown[]) => Promise<string> } } }).api.git.createWorktree(
      repo,
      'pi-switch-a',
      'pi-switch-a',
      true,
    )
    const workspaceAId = crypto.randomUUID()
    store.addWorkspace({
      id: workspaceAId,
      name: 'pi-switch-a',
      branch: 'pi-switch-a',
      worktreePath: worktreeA,
      projectId,
    })
    await store.createPiThreadForActiveWorkspace()
    const tabAId = getState().activeTabId

    const worktreeB = await (window as unknown as { api: { git: { createWorktree: (...a: unknown[]) => Promise<string> } } }).api.git.createWorktree(
      repo,
      'pi-switch-b',
      'pi-switch-b',
      true,
    )
    const workspaceBId = crypto.randomUUID()
    store.addWorkspace({
      id: workspaceBId,
      name: 'pi-switch-b',
      branch: 'pi-switch-b',
      worktreePath: worktreeB,
      projectId,
    })
    await store.createPiThreadForActiveWorkspace()
    const tabBId = getState().activeTabId

    return {
      workspaceAId,
      workspaceBId,
      worktreeA,
      worktreeB,
      tabAId,
      tabBId,
    }
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

  test('two PI Chat tabs bind different Pi sessions', async () => {
    const repoPath = createTestRepo('pi-thread-multi')
    const { app, window } = await launchApp()

    try {
      const setup = await setupWorkspaceWithTwoPiThreads(window, repoPath)
      if (setup.setupError) {
        throw new Error(`setupWorkspaceWithTwoPiThreads: ${setup.setupError}`)
      }
      const { tabA, tabB } = setup
      await window.waitForTimeout(2500)
      const tabsInfo = await window.evaluate(() => {
        const tabs = (window as unknown as { __store: { getState: () => { tabs: { type: string; piSessionId?: string }[] } } }).__store
          .getState()
          .tabs.filter((t) => t.type === 'pi-thread')
        return tabs.map((t) => ({ id: t.id, piSessionId: t.piSessionId }))
      })
      if (tabsInfo.length < 2) {
        throw new Error(`Expected 2 pi-thread tabs, got ${JSON.stringify(tabsInfo)}`)
      }
      const sessionA = tabsInfo[tabsInfo.length - 2].piSessionId
      const sessionB = tabsInfo[tabsInfo.length - 1].piSessionId
      if (!sessionA || !sessionB) {
        throw new Error(`Missing piSessionId on tab(s): ${JSON.stringify(tabsInfo)}`)
      }
      if (sessionA === sessionB) {
        throw new Error(`Both PI tabs bound to same session: ${JSON.stringify(tabsInfo)}`)
      }

      const sendA = `e2e-pi-tab-a-${Date.now()}`
      await window.evaluate(
        (id) => (window as unknown as { __store: { getState: () => any } }).__store.getState().setActiveTab(id),
        tabA,
      )
      await window.waitForTimeout(800)
      await window.getByTestId('composer').fill(sendA)
      await window.getByTestId('send').click()
      await expect(window.getByTestId('transcript')).toContainText(sendA, { timeout: 15000 })

      const sendB = `e2e-pi-tab-b-${Date.now()}`
      await window.evaluate(
        (id) => (window as unknown as { __store: { getState: () => any } }).__store.getState().setActiveTab(id),
        tabB,
      )
      await window.waitForTimeout(800)
      await window.getByTestId('composer').fill(sendB)
      await window.getByTestId('send').click()
      await expect(window.getByTestId('transcript')).toContainText(sendB, { timeout: 15000 })
      await expect(window.getByTestId('transcript')).not.toContainText(sendA)

      await window.evaluate(
        (id) => (window as unknown as { __store: { getState: () => any } }).__store.getState().setActiveTab(id),
        tabA,
      )
      await window.waitForTimeout(800)
      await expect(window.getByTestId('transcript')).toContainText(sendA, { timeout: 10000 })
      await expect(window.getByTestId('transcript')).not.toContainText(sendB)
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

  test('rapid workspace switches keep Pi synced to the newly active worktree', async () => {
    const repoPath = createTestRepo('pi-thread-switch')
    const { app, window } = await launchApp()

    try {
      const setup = await setupTwoWorkspacesWithPiThreads(window, repoPath)
      await window.waitForTimeout(2500)

      await window.evaluate(({ workspaceAId, tabAId }) => {
        const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
        store.setActiveWorkspace(workspaceAId)
        store.setActiveTab(tabAId)
      }, { workspaceAId: setup.workspaceAId, tabAId: setup.tabAId })

      await expect(window.getByTestId('composer')).toBeVisible({ timeout: 15000 })
      const messageA = `workspace-a-${Date.now()}`
      await window.getByTestId('composer').fill(messageA)
      await window.getByTestId('send').click()
      await expect(window.getByTestId('transcript')).toContainText(messageA, { timeout: 15000 })

      await window.evaluate(({ workspaceBId, tabBId }) => {
        const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
        store.setActiveWorkspace(workspaceBId)
        store.setActiveTab(tabBId)
      }, { workspaceBId: setup.workspaceBId, tabBId: setup.tabBId })

      await expect(window.getByTestId('composer')).toBeVisible({ timeout: 15000 })
      await expect(window.getByTestId('transcript')).not.toContainText(messageA)
      const messageB = `workspace-b-${Date.now()}`
      await window.getByTestId('composer').fill(messageB)
      await window.getByTestId('send').click()
      await expect(window.getByTestId('transcript')).toContainText(messageB, { timeout: 15000 })
      await expect(window.getByTestId('transcript')).not.toContainText(messageA)
    } finally {
      await app.close()
    }
  })
})
