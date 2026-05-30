import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const COMPOSER = '[data-testid="composer-draft-editor"]'

async function expectComposerDraft(
  composer: ReturnType<Page['locator']>,
  draft: string,
): Promise<void> {
  await expect(composer).toHaveAttribute('data-composer-draft', draft)
}

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

async function openConductorTab(window: Page): Promise<void> {
  await window.evaluate(() => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    store.createConductorTabForActiveWorkspace()
  })
}

async function closeAllConductorTabs(window: Page): Promise<void> {
  await window.evaluate(() => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    for (const tab of [...store.tabs].filter((t: { type: string }) => t.type === 'conductor')) {
      store.removeTab(tab.id)
    }
  })
}

async function ensureCodexProvider(window: Page): Promise<void> {
  await window.evaluate(() => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    store.updateSettings({ conductorDefaultProvider: 'codex', conductorDefaultModel: 'gpt-5-codex' })
  })
}

async function mockSlashApis(window: Page): Promise<void> {
  await window.evaluate(() => {
    const api = (window as unknown as { api: any }).api
    api.skills.discoverHarness = async () => [
      { name: 'caveman', description: 'Brief mode', sourcePath: '/tmp/caveman' },
    ]
    api.mcp.probeStatus = async () => ({
      servers: [{ name: 'CODEX_APPS', status: 'ok' }],
      probedAt: Date.now(),
    })
    api.codex.getPersonality = async () => ({ personality: 'pragmatic' })
    api.codex.setPersonality = async (personality: string) => ({ personality })
    api.pty.create = async () => 'test-pty-id'
    api.pty.destroy = () => {}
    api.pty.onData = () => () => {}
    api.pty.reattach = async () => true
    api.pty.resize = () => {}
  })
}

async function installOpenPrListE2eHook(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const global = globalThis as {
      __e2eOpenPrsRows?: unknown[]
      __e2eOpenPrsCallCount?: number
      __e2eOpenPrsHandler?: (repoPath: string) => { available: boolean; data: unknown[] }
    }
    global.__e2eOpenPrsRows = []
    global.__e2eOpenPrsCallCount = 0
    global.__e2eOpenPrsHandler = () => {
      global.__e2eOpenPrsCallCount = (global.__e2eOpenPrsCallCount ?? 0) + 1
      return { available: true, data: global.__e2eOpenPrsRows ?? [] }
    }
  })
}

async function mockOpenPrList(
  app: ElectronApplication,
  window: Page,
  rows: unknown[],
): Promise<void> {
  await app.evaluate((data) => {
    const global = globalThis as {
      __e2eOpenPrsRows?: unknown[]
      __e2eOpenPrsCallCount?: number
    }
    global.__e2eOpenPrsRows = data
    global.__e2eOpenPrsCallCount = 0
  }, rows)
  await window.evaluate(() => {
    const cache = (
      window as unknown as { __composerOpenPrListByRepo?: Map<string, unknown> }
    ).__composerOpenPrListByRepo
    cache?.clear()
  })
}

async function waitForOpenPrPrefetch(window: Page, _app: ElectronApplication): Promise<void> {
  await window.locator(COMPOSER).waitFor({ state: 'visible' })
  await expect
    .poll(async () => {
      return await window.evaluate(() => {
        const cache = (
          window as unknown as {
            __composerOpenPrListByRepo?: Map<string, { data: unknown[] }>
          }
        ).__composerOpenPrListByRepo
        if (!cache) return 0
        for (const entry of cache.values()) {
          if ((entry?.data?.length ?? 0) > 0) return entry.data.length
        }
        return 0
      })
    }, { timeout: 15_000 })
    .toBeGreaterThan(0)
}

async function resetOpenPrListCallCount(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    ;(globalThis as { __e2eOpenPrsCallCount?: number }).__e2eOpenPrsCallCount = 0
  })
}

test.describe('Conductor slash menu', () => {
  let app: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    ;({ app, window } = await launchApp())
    await installOpenPrListE2eHook(app)
  })

  test.afterAll(async () => {
    await app.close()
  })

  test('opens menu, filters, and dispatches plan immediately', async () => {
    const repoPath = createTestRepo('slash-menu')
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await openConductorTab(window)
    await mockSlashApis(window)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('/pla')
    await composer.press('End')
    await expect(window.locator('[data-testid="conductor-slash-menu"]')).toContainText('/plan')

    await composer.press('Enter')

    await expectComposerDraft(composer, '')
    await expect(window.locator('[data-testid="conductor-slash-menu"]')).toHaveCount(0)
    await expect(window.locator('[data-testid="conductor-chat-view"] button[data-plan-active="true"]')).toBeVisible()
  })

  test('Esc dismisses slash token without submitting', async () => {
    await composerFillAndEsc(window)
  })

  test('personality picker dispatches harness command', async () => {
    const repoPath = createTestRepo('slash-personality')
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await openConductorTab(window)
    await mockSlashApis(window)

    await window.evaluate(async () => {
      const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
      const wsId = store.activeWorkspaceId
      const ws = store.workspaces.find((w: any) => w.id === wsId)
      const tab = store.tabs.find((t: any) => t.type === 'conductor')
      const api = (window as unknown as { api: any }).api
      const created = await api.agentChat.createSession({
        workspaceId: wsId,
        workspacePath: ws.worktreePath,
        provider: 'codex',
        model: 'gpt-5-codex',
        title: 'personality test',
      })
      if (tab) {
        store.setConductorTabSessionBinding(tab.id, created.sessionId, 'personality test')
      }
    })

    await window.waitForFunction(() => {
      const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
      const tab = store.tabs.find((t: any) => t.type === 'conductor')
      return Boolean(tab?.agentSessionId)
    })

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('/personality')
    await composer.press('End')
    await composer.press('Enter')
    await expect(window.locator('[data-testid="conductor-personality-menu"]')).toBeVisible()
    await window.locator('[data-testid="conductor-personality-menu"] button').nth(1).click()

    await expect(window.locator('[data-testid="conductor-personality-menu"]')).toHaveCount(0)
    await expectComposerDraft(composer, '')
  })

  test('hash menu lists PRs and inserts mention', async () => {
    const repoPath = createTestRepo('hash-menu')
    await mockOpenPrList(app, window, [
      {
        number: 170,
        state: 'open',
        title: 'docs(agents): add automation section',
        url: 'https://github.com/o/r/pull/170',
        checkStatus: 'none',
        hasPendingComments: false,
        pendingCommentCount: 0,
        isBlockedByCi: false,
        isApproved: false,
        isChangesRequested: false,
        updatedAt: '2026-01-01T00:00:00Z',
        headRefName: 'auto/constellagent-email-to-pr/20240516',
        baseRefName: 'main',
        isCrossRepository: false,
        authorLogin: 'tri',
      },
      {
        number: 42,
        state: 'open',
        title: 'Fix login bug',
        url: 'https://github.com/o/r/pull/42',
        checkStatus: 'none',
        hasPendingComments: false,
        pendingCommentCount: 0,
        isBlockedByCi: false,
        isApproved: false,
        isChangesRequested: false,
        updatedAt: '2026-01-01T00:00:00Z',
        headRefName: 'fix/login',
        baseRefName: 'main',
        isCrossRepository: false,
      },
    ])
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await mockSlashApis(window)

    await closeAllConductorTabs(window)
    await resetOpenPrListCallCount(app)
    await openConductorTab(window)
    await waitForOpenPrPrefetch(window, app)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('#17')
    await composer.press('End')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).toContainText('#170')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).not.toContainText('#42')

    await composer.press('Enter')
    await expect(window.locator('[data-testid="composer-pr-chip"]')).toBeVisible()
    await expectComposerDraft(composer, '#170 ')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).toHaveCount(0)
  })

  test('hash menu reuses prefetched PR list without extra IPC on keystrokes', async () => {
    const repoPath = createTestRepo('hash-menu-cache')
    await mockOpenPrList(app, window, [
      {
        number: 170,
        state: 'open',
        title: 'docs(agents): add automation section',
        url: 'https://github.com/o/r/pull/170',
        checkStatus: 'none',
        hasPendingComments: false,
        pendingCommentCount: 0,
        isBlockedByCi: false,
        isApproved: false,
        isChangesRequested: false,
        updatedAt: '2026-01-01T00:00:00Z',
        headRefName: 'auto/constellagent-email-to-pr/20240516',
        baseRefName: 'main',
        isCrossRepository: false,
        authorLogin: 'tri',
      },
    ])
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await mockSlashApis(window)

    await closeAllConductorTabs(window)
    await resetOpenPrListCallCount(app)
    await openConductorTab(window)
    await waitForOpenPrPrefetch(window, app)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('#')
    await composer.press('End')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).toContainText('#170')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).not.toContainText(
      'Loading open pull requests',
    )

    await composer.press('Escape')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).toHaveCount(0)

    await composer.fill('#17')
    await composer.press('End')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).toContainText('#170')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).not.toContainText(
      'Loading open pull requests',
    )

    const callCount = await app.evaluate(
      () => (globalThis as { __e2eOpenPrsCallCount?: number }).__e2eOpenPrsCallCount ?? 0,
    )
    expect(callCount).toBe(1)
  })

  test('skill slash pick renders chip and accepts typing after it', async () => {
    const repoPath = createTestRepo('slash-skill-chip')
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await openConductorTab(window)
    await mockSlashApis(window)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('/cave')
    await composer.press('End')
    await expect(window.locator('[data-testid="conductor-slash-menu"]')).toContainText('/caveman')
    await composer.press('Enter')

    await expect(window.locator('[data-testid="composer-skill-chip"]')).toBeVisible()
    await expectComposerDraft(composer, '/caveman ')
    await composer.pressSequentially('more text')
    await expectComposerDraft(composer, '/caveman more text')
  })

  test('at menu lists files and inserts mention', async () => {
    const repoPath = createTestRepo('at-menu')
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src', 'App.tsx'), 'export {}\n')
    execSync('git add .', { cwd: repoPath })
    execSync('git commit -m "add app file"', { cwd: repoPath })
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await openConductorTab(window)
    await mockSlashApis(window)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('@App')
    await composer.press('End')
    await expect(window.locator('[data-testid="conductor-at-menu"]')).toContainText('App.tsx')

    await composer.press('Enter')
    await expect(window.locator('[data-testid="composer-file-chip"]')).toContainText('App.tsx')
    await expectComposerDraft(composer, '@src/App.tsx ')
    await expect(window.locator('[data-testid="conductor-at-menu"]')).toHaveCount(0)
    await composer.pressSequentially('tail')
    await expectComposerDraft(composer, '@src/App.tsx tail')
  })

  test('backspace after inline file mention removes the chip token', async () => {
    const repoPath = createTestRepo('at-menu-backspace')
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src', 'App.tsx'), 'export {}\n')
    execSync('git add .', { cwd: repoPath })
    execSync('git commit -m "add app file"', { cwd: repoPath })
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await openConductorTab(window)
    await mockSlashApis(window)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('@App')
    await composer.press('End')
    await expect(window.locator('[data-testid="conductor-at-menu"]')).toContainText('App.tsx')
    await composer.press('Enter')
    await expect(window.locator('[data-testid="composer-file-chip"]')).toHaveCount(1)
    await expectComposerDraft(composer, '@src/App.tsx ')

    await composer.press('Backspace')
    await expect(window.locator('[data-testid="composer-file-chip"]')).toHaveCount(0)
    await expectComposerDraft(composer, '')
  })

  test('Esc dismisses hash token without submitting', async () => {
    const repoPath = createTestRepo('hash-menu-esc')
    await mockOpenPrList(app, window, [
      {
        number: 5,
        state: 'open',
        title: 'Sample PR',
        url: 'https://github.com/o/r/pull/5',
        checkStatus: 'none',
        hasPendingComments: false,
        pendingCommentCount: 0,
        isBlockedByCi: false,
        isApproved: false,
        isChangesRequested: false,
        updatedAt: '2026-01-01T00:00:00Z',
        headRefName: 'feature/sample',
        baseRefName: 'main',
        isCrossRepository: false,
      },
    ])
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await mockSlashApis(window)

    await openConductorTab(window)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('#')
    await composer.press('End')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).toBeVisible()
    await composer.press('Escape')
    await expectComposerDraft(composer, '')
    await expect(window.locator('[data-testid="conductor-hash-menu"]')).toHaveCount(0)
  })

  test('mcp-status panel opens from slash menu', async () => {
    const repoPath = createTestRepo('slash-mcp-status')
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await openConductorTab(window)
    await mockSlashApis(window)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('/mcp-status')
    await composer.press('Enter')
    await expect(window.locator('[data-testid="conductor-mcp-status-panel"]')).toBeVisible()
    await expect(window.locator('[data-testid="conductor-mcp-status-panel"]')).toContainText('MCP status')
  })

  test('mcp banner opens embedded terminal', async () => {
    const repoPath = createTestRepo('slash-mcp-terminal')
    await setupWorkspace(window, repoPath)
    await ensureCodexProvider(window)
    await openConductorTab(window)
    await mockSlashApis(window)

    const composer = window.locator(COMPOSER)
    await composer.click()
    await composer.fill('/mcp')
    await composer.press('Enter')
    await expect(window.locator('[data-testid="conductor-mcp-banner"]')).toBeVisible()
    await window.locator('[data-testid="conductor-mcp-banner"] button:has-text("Open terminal")').click()
    await expect(window.locator('[data-testid="conductor-embedded-terminal"]')).toBeVisible()
    await window.locator('[data-testid="conductor-embedded-terminal"] button:has-text("Done")').click()
    await expect(window.locator('[data-testid="conductor-embedded-terminal"]')).toHaveCount(0)
  })
})

async function composerFillAndEsc(window: Page): Promise<void> {
  const repoPath = createTestRepo('slash-esc')
  await setupWorkspace(window, repoPath)
  await openConductorTab(window)
  await mockSlashApis(window)

  const composer = window.locator(COMPOSER)
  await composer.click()
  await composer.fill('/clear')
  await expect(window.locator('[data-testid="conductor-slash-menu"]')).toBeVisible()
  await composer.press('Escape')
  await expect(window.locator('[data-testid="conductor-slash-menu"]')).toHaveCount(0)
  await expectComposerDraft(composer, '')
}
