import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const appPath = resolve(__dirname, '../out/main/index.js')

function createUserDataPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), `constellagent-${name}-`)), 'user-data')
}

async function launchApp(userDataPath: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appPath],
    env: { ...process.env, CI_TEST: '1', CONSTELLAGENT_USER_DATA_PATH: userDataPath },
    timeout: 60_000,
  })
  const window = await app.firstWindow({ timeout: 60_000 })
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 15_000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

async function withApp<T>(
  name: string,
  run: (ctx: { app: ElectronApplication; window: Page }) => Promise<T>,
): Promise<T> {
  const userDataPath = createUserDataPath(name)
  const { app, window } = await launchApp(userDataPath)
  try {
    return await run({ app, window })
  } finally {
    await app.close()
    rmSync(userDataPath, { recursive: true, force: true })
  }
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

async function setupWorkspace(window: Page, repoPath: string): Promise<{ wsId: string; worktreePath: string }> {
  return await window.evaluate(async (repo: string) => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    store.hydrateState({ projects: [], workspaces: [], tabs: [] })
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
    return { wsId, worktreePath }
  }, repoPath)
}

test.describe.configure({ timeout: 120_000 })

test.describe('pi-gui rip-out regression', () => {
  test('removes window.api.pi and keeps agentChat Pi conductor APIs', async () => {
    await withApp('pi-api-surface', async ({ window }) => {
      const surface = await window.evaluate(() => {
        const api = (window as unknown as { api: Record<string, unknown> }).api
        const agentChat = api.agentChat as Record<string, unknown> | undefined
        return {
          hasPiNamespace: 'pi' in api,
          respondPiHostUi: typeof agentChat?.respondPiHostUi,
          sendPiExtensionTuiInput: typeof agentChat?.sendPiExtensionTuiInput,
          listPiModels: typeof agentChat?.listPiModels,
          createSession: typeof agentChat?.createSession,
        }
      })

      expect(surface.hasPiNamespace).toBe(false)
      expect(surface.respondPiHostUi).toBe('function')
      expect(surface.sendPiExtensionTuiInput).toBe('function')
      expect(surface.listPiModels).toBe('function')
      expect(surface.createSession).toBe('function')
    })
  })

  test('tab bar has no PI Chat launcher', async () => {
    await withApp('pi-tabbar', async ({ window }) => {
      const repoPath = createTestRepo('pi-ripout-tabbar')
      await setupWorkspace(window, repoPath)

      expect(await window.getByRole('button', { name: 'PI Chat' }).count()).toBe(0)
      expect(await window.getByLabel('PI Chat').count()).toBe(0)
      expect(await window.locator('[aria-label="Open PI Chat"]').count()).toBe(0)
    })
  })

  test('hydrating legacy pi-thread persisted tabs does not crash or leave orphan tabs', async () => {
    await withApp('pi-hydrate', async ({ window }) => {
      const repoPath = createTestRepo('pi-ripout-hydrate')
      const { wsId } = await setupWorkspace(window, repoPath)

      const tabState = await window.evaluate(
        async ({ workspaceId }: { workspaceId: string }) => {
          const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
          store.hydrateState({
            projects: store.projects,
            workspaces: store.workspaces,
            activeWorkspaceId: workspaceId,
            tabs: [
              {
                id: 'legacy-pi-tab',
                workspaceId,
                type: 'pi-thread',
                title: 'PI Chat',
                piSessionId: 'old-session',
                piSessionTitle: 'Old',
              },
              {
                id: 'keep-terminal',
                workspaceId,
                type: 'terminal',
                title: 'Shell',
                ptyId: 'pty-legacy',
              },
            ],
            activeTabId: 'legacy-pi-tab',
            lastActiveTabByWorkspace: { [workspaceId]: 'legacy-pi-tab' },
          })
          const next = store.tabs.filter((t: { workspaceId: string }) => t.workspaceId === workspaceId)
          return {
            tabTypes: next.map((t: { type: string }) => t.type),
            tabIds: next.map((t: { id: string }) => t.id),
            activeTabId: store.activeTabId,
            lastActive: store.lastActiveTabByWorkspace[workspaceId] ?? null,
          }
        },
        { workspaceId: wsId },
      )

      expect(tabState.tabTypes).toEqual(['terminal'])
      expect(tabState.tabIds).toEqual(['keep-terminal'])
      expect(tabState.activeTabId).toBeNull()
      expect(tabState.lastActive).toBeNull()
    })
  })

  test('Conductor model dropdown still lists Pi provider', async () => {
    await withApp('pi-model-menu', async ({ window }) => {
      const repoPath = createTestRepo('pi-ripout-model')
      await setupWorkspace(window, repoPath)

      await window.evaluate(() => {
        const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
        store.createConductorTabForActiveWorkspace()
      })

      await expect(window.getByPlaceholder('Ask to make changes')).toBeVisible({ timeout: 5000 })

      const modelButton = window.locator('[aria-haspopup="listbox"]').first()
      await modelButton.click()
      await expect(window.getByRole('listbox')).toBeVisible()
      await expect(window.getByText('Pi', { exact: true })).toBeVisible()
      await expect(window.getByText('Codex', { exact: true })).toBeVisible()
      await expect(window.getByText('Cursor', { exact: true })).toBeVisible()
    })
  })

  test('agentChat can create a Pi Conductor session', async () => {
    await withApp('pi-create-session', async ({ window }) => {
      const repoPath = createTestRepo('pi-ripout-session')
      const { wsId, worktreePath } = await setupWorkspace(window, repoPath)

      const session = await window.evaluate(
        async ({ workspaceId, path }: { workspaceId: string; path: string }) => {
          const api = (window as unknown as {
            api: {
              agentChat: {
                createSession: (input: unknown) => Promise<{ sessionId: string; provider: string }>
                getSession: (id: string) => Promise<{ state: { provider: string; model: string } } | null>
              }
            }
          }).api
          const created = await api.agentChat.createSession({
            workspaceId,
            workspacePath: path,
            provider: 'pi',
            model: 'anthropic/claude-sonnet-4-5',
            title: 'Pi regression session',
          })
          const loaded = await api.agentChat.getSession(created.sessionId)
          return {
            sessionId: created.sessionId,
            provider: loaded?.state.provider ?? null,
            model: loaded?.state.model ?? null,
          }
        },
        { workspaceId: wsId, path: worktreePath },
      )

      expect(session.sessionId.length).toBeGreaterThan(0)
      expect(session.provider).toBe('pi')
      expect(session.model).toBeTruthy()
    })
  })

  test('agentChat.listPiModels resolves without throwing', async () => {
    await withApp('pi-list-models', async ({ window }) => {
      const repoPath = createTestRepo('pi-ripout-models')
      const { worktreePath } = await setupWorkspace(window, repoPath)

      const models = await window.evaluate(async (path: string) => {
        const api = (window as unknown as {
          api: { agentChat: { listPiModels: (ws: string) => Promise<readonly unknown[]> } }
        }).api
        return await api.agentChat.listPiModels(path)
      }, worktreePath)

      expect(Array.isArray(models)).toBe(true)
    })
  })
})
