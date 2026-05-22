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

async function setupWorkspace(window: Page, repoPath: string): Promise<void> {
  await window.evaluate(async (repo: string) => {
    const getState = (window as unknown as { __store: { getState: () => any } }).__store.getState
    const store = getState()
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
  }, repoPath)
}

async function createAndSelectSession(window: Page, title: string): Promise<string> {
  return await window.evaluate(async (sessionTitle: string) => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    const wsId = store.activeWorkspaceId
    const ws = store.workspaces.find((w: any) => w.id === wsId)
    const api = (window as unknown as { api: { agentChat: { createSession: (input: unknown) => Promise<{ sessionId: string }> } } }).api
    const created = await api.agentChat.createSession({
      workspaceId: wsId,
      workspacePath: ws.worktreePath,
      provider: 'codex',
      model: 'gpt-5-codex',
      title: sessionTitle,
    })
    store.openConductorSessionTab(created.sessionId, sessionTitle)
    return created.sessionId
  }, title)
}

test.describe('Conductor message queue', () => {
  let app: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    ;({ app, window } = await launchApp())
  })

  test.afterAll(async () => {
    await app.close()
  })

  test('shows the queue strip inside the composer when messages are queued', async () => {
    const repoPath = createTestRepo('conductor-queue')
    await setupWorkspace(window, repoPath)

    const title = `queue-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)

    const session = await window.evaluate(async (sid: string) => {
      return await (
        window as unknown as {
          api: { agentChat: { getSession: (id: string) => Promise<{ state: Record<string, unknown> } | null> } }
        }
      ).api.agentChat.getSession(sid)
    }, sessionId)
    expect(session?.state).toBeTruthy()

    const queuedAt = new Date().toISOString()
    await app.evaluate(
      ({ BrowserWindow }, payload: { state: Record<string, unknown>; queuedAt: string }) => {
        const nextState = {
          ...payload.state,
          status: 'running' as const,
          queuedMessages: [
            {
              id: 'q1',
              mode: 'followUp' as const,
              text: 'Follow up after this turn finishes',
              createdAt: payload.queuedAt,
              updatedAt: payload.queuedAt,
            },
          ],
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('agent-chat:state-changed', nextState)
        }
      },
      { state: session!.state, queuedAt },
    )

    const queue = window.getByTestId('conductor-message-queue')
    await expect(queue).toBeVisible({ timeout: 5000 })
    await expect(queue).toContainText('1 queued message')
    await expect(queue).toContainText('Follow up after this turn finishes')

    const composerInner = window.locator('[class*="composerInner"]').first()
    await expect(composerInner.getByTestId('conductor-message-queue')).toBeVisible()
    await expect(
      composerInner.getByText('Enter · queue · ⌘↵ · steer · Esc · stop'),
    ).toBeVisible()
  })

  test('shows running keyboard hints in the composer hint slot', async () => {
    const repoPath = createTestRepo('conductor-queue-hint')
    await setupWorkspace(window, repoPath)

    const title = `queue-hint-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const session = await window.evaluate(async (sid: string) => {
      return await (
        window as unknown as {
          api: { agentChat: { getSession: (id: string) => Promise<{ state: Record<string, unknown> } | null> } }
        }
      ).api.agentChat.getSession(sid)
    }, sessionId)

    await app.evaluate(
      ({ BrowserWindow }, payload: { state: Record<string, unknown> }) => {
        const nextState = { ...payload.state, status: 'running' as const, queuedMessages: [] }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('agent-chat:state-changed', nextState)
        }
      },
      { state: session!.state },
    )

    await expect(window.getByText('Enter · queue · ⌘↵ · steer · Esc · stop')).toBeVisible({ timeout: 5000 })
  })
})
