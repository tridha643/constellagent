import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
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
  await window.waitForTimeout(1000)
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

test.describe('Conductor AskQuestion UI', () => {
  let app: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    ;({ app, window } = await launchApp())
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('exposes respondBlockingQuestion on agentChat API', async () => {
    const hasRespond = await window.evaluate(() => {
      return typeof (window as unknown as { api: { agentChat: { respondBlockingQuestion?: unknown } } }).api
        .agentChat.respondBlockingQuestion === 'function'
    })
    expect(hasRespond).toBe(true)
  })

  test('renders a blocking question modal and enables answer submission', async () => {
    const repoPath = createTestRepo('conductor-ask-question')
    await setupWorkspace(window, repoPath)

    const title = `ask-question-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const session = await window.evaluate(async (sid: string) => {
      return await (
        window as unknown as {
          api: { agentChat: { getSession: (id: string) => Promise<{ state: Record<string, unknown> } | null> } }
        }
      ).api.agentChat.getSession(sid)
    }, sessionId)
    expect(session?.state).toBeTruthy()

    await app.evaluate(
      ({ BrowserWindow }, payload: { state: Record<string, unknown> }) => {
        const now = new Date().toISOString()
        const nextState = {
          ...payload.state,
          status: 'running' as const,
          runPhase: 'awaitingUser' as const,
          blockingQuestion: {
            requestId: 'question-1',
            sessionId: payload.state.sessionId,
            callId: 'codex-ask-user:item-1',
            provider: 'codex' as const,
            source: 'askQuestion' as const,
            createdAt: now,
            questions: [
              {
                header: 'Scope',
                question: 'Which implementation path should I take?',
                options: [
                  { label: 'Keep scope narrow', description: 'Only wire the current panel behavior.' },
                  { label: 'Broaden coverage', description: 'Add cross-provider coverage too.' },
                ],
              },
            ],
          },
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('agent-chat:state-changed', nextState)
        }
      },
      { state: session!.state },
    )

    const dialog = window.getByRole('dialog', { name: 'Which implementation path should I take?' })
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog).toContainText('Scope')
    const submit = dialog.getByRole('button', { name: 'Submit answers' })
    await expect(submit).toBeDisabled()
    await dialog.getByText('A · Keep scope narrow').click()
    await expect(submit).toBeEnabled()
  })
})
