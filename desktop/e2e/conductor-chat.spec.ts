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
    return { wsId }
  }, repoPath)
}

async function openConductorTab(window: Page): Promise<void> {
  await window.evaluate(() => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    store.createConductorTabForActiveWorkspace()
  })
}

/** Creates a Conductor session for the active workspace and opens a bound conductor tab. */
async function createAndSelectSession(
  window: Page,
  title: string,
  options?: { plan?: boolean },
): Promise<string> {
  return await window.evaluate(async ({ sessionTitle, plan }: { sessionTitle: string; plan?: boolean }) => {
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
      plan,
    })
    store.openConductorSessionTab(created.sessionId, sessionTitle)
    return created.sessionId
  }, { sessionTitle: title, plan: options?.plan })
}

/** Pushes a crafted transcript to the renderer through the same IPC channel the host uses. */
async function injectTranscript(
  app: ElectronApplication,
  sessionId: string,
  transcript: unknown[],
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agent-chat:transcript-changed', payload)
      }
    },
    { sessionId, transcript },
  )
}

function nowIso(): string {
  return new Date().toISOString()
}

test.describe('Conductor chat view', () => {
  let app: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    ;({ app, window } = await launchApp())
  })

  test.afterAll(async () => {
    await app.close()
  })

  test('opens the view with composer + model dropdown; T3 Code is gone', async () => {
    const repoPath = createTestRepo('conductor')
    await setupWorkspace(window, repoPath)

    // T3 Code entry point must be fully removed.
    expect(await window.locator('[aria-label="Open T3 Code"]').count()).toBe(0)

    // Open Conductor without relying on prior test state.
    await openConductorTab(window)

    // Composer renders.
    await expect(window.getByPlaceholder('Ask to make changes')).toBeVisible({ timeout: 5000 })
    // Plan toggle renders.
    await expect(window.getByRole('button', { name: 'Plan', exact: true })).toBeVisible()
    // Cursor defaults to a reasoning-capable family, so the effort picker is visible.
    await expect(window.getByRole('button', { name: /Reasoning effort:/ })).toBeVisible()

    // Model dropdown renders and lists both providers.
    const modelButton = window.locator('[aria-haspopup="listbox"]').first()
    await expect(modelButton).toBeVisible()
    await modelButton.click()
    await expect(window.getByRole('listbox')).toBeVisible()
    await expect(window.getByText('Cursor', { exact: true })).toBeVisible()
    await expect(window.getByText('Codex', { exact: true })).toBeVisible()
  })

  test('keeps Default typography but Absolutely color tokens in Conductor chat', async () => {
    const repoPath = createTestRepo('conductor-theme-isolation')
    await setupWorkspace(window, repoPath)

    await window.evaluate(() => {
      const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
      store.updateSettings({ appearanceThemeId: 'absolutely' })
    })
    await window.waitForTimeout(300)

    await openConductorTab(window)
    await expect(window.getByPlaceholder(/Ask to make changes/)).toBeVisible({ timeout: 5000 })

    const sessionId = await createAndSelectSession(window, `theme-rail-${Date.now()}`)
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'rail typography check', createdAt: nowIso() },
    ])
    await expect(window.getByTestId('conductor-turn-rail')).toBeAttached({ timeout: 5000 })

    const tokens = await window.evaluate(() => {
      const chat = document.querySelector('[data-testid="conductor-chat-view"]') as HTMLElement | null
      const composer = document.querySelector(
        '[data-testid="composer-draft-editor"]',
      ) as HTMLElement | null
      if (!chat || !composer) return null
      const chatStyle = getComputedStyle(chat)
      const composerStyle = getComputedStyle(composer)
      const rootStyle = getComputedStyle(document.documentElement)
      return {
        chatFontUi: chatStyle.getPropertyValue('--font-ui').trim(),
        chatSurface0: chatStyle.getPropertyValue('--surface-0').trim(),
        composerFont: composerStyle.fontFamily,
        rootFontUi: rootStyle.getPropertyValue('--font-ui').trim(),
      }
    })

    expect(tokens).not.toBeNull()
    expect(tokens!.rootFontUi).toContain('ui-monospace')
    expect(tokens!.chatFontUi).toContain('-apple-system')
    expect(tokens!.chatSurface0).toBe('#242422')
    expect(tokens!.composerFont).toMatch(/-apple-system|SF Pro/i)

    const railTokens = await window.evaluate(() => {
      const rail = document.querySelector('[data-testid="conductor-turn-rail"]') as HTMLElement | null
      if (!rail) return null
      const style = getComputedStyle(rail)
      return {
        fontUi: style.getPropertyValue('--font-ui').trim(),
        fontFamily: style.fontFamily,
        textPrimary: style.getPropertyValue('--text-primary').trim(),
      }
    })
    expect(railTokens).not.toBeNull()
    expect(railTokens!.fontUi).toContain('-apple-system')
    expect(railTokens!.fontFamily).toMatch(/-apple-system|SF Pro/i)
    expect(railTokens!.textPrimary).toBe('#f9f9f7')
  })

  test('uses the configured conductor default model for new draft chats', async () => {
    const repoPath = createTestRepo('conductor-defaults')
    await setupWorkspace(window, repoPath)

    await window.evaluate(() => {
      const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
      store.updateSettings({
        conductorDefaultProvider: 'codex',
        conductorDefaultModel: 'gpt-5.4-mini',
      })
    })

    await openConductorTab(window)

    const modelButton = window.locator('[aria-haspopup="listbox"]').first()
    await expect(modelButton).toContainText('GPT-5.4 mini')
  })

  test('context ring estimates draft composer tokens before a session exists', async () => {
    const repoPath = createTestRepo('conductor-context-ring-draft')
    await setupWorkspace(window, repoPath)

    await window.evaluate(() => {
      const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
      store.updateSettings({
        conductorDefaultProvider: 'codex',
        conductorDefaultModel: 'gpt-5.4',
      })
    })

    await openConductorTab(window)

    const composer = window.locator('[data-testid="composer-draft-editor"]')
    await expect(composer).toBeVisible({ timeout: 5000 })
    await composer.fill('a'.repeat(4_000))

    const ring = window.getByTestId('conductor-context-ring')
    await expect(ring).toHaveAttribute('aria-label', 'Context window 0.1% used')
  })

  test('shows a global GSD-scaled context pill in the Conductor panel', async () => {
    const repoPath = createTestRepo('conductor-global-context-pill')
    await setupWorkspace(window, repoPath)

    const sessionId = await createAndSelectSession(window, `global-context-${Date.now()}`)
    await injectTranscript(app, sessionId, [
      {
        kind: 'message',
        id: 'u1',
        role: 'user',
        text: 'a'.repeat(80_000),
        createdAt: nowIso(),
      },
    ])

    const pill = window.getByTestId('conductor-global-context-pill')
    await expect(pill).toBeVisible({ timeout: 5000 })
    await expect(pill).toHaveAttribute('data-tier', 'low')
    await expect(pill).toContainText('13%')
    await expect(pill).toHaveAttribute('title', /Claude Code 80% limit/)
  })

  test('opens previous messages panel from turn rail', async () => {
    const repoPath = createTestRepo('conductor-history')
    await setupWorkspace(window, repoPath)

    const title = `history-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const transcript = [
      { kind: 'message', id: 'u1', role: 'user', text: 'hello', createdAt: nowIso() },
    ]
    await injectTranscript(app, sessionId, transcript)
    await expect(window.locator('[class*="messageBody"]').filter({ hasText: 'hello' })).toBeVisible({
      timeout: 10000,
    })

    // Rail ticks sit under aria-hidden host until hover; target the zone, not the nav role.
    await window.getByRole('navigation', { name: 'Chat turns' }).hover()
    await expect(window.getByRole('menu', { name: 'Previous messages' })).toBeVisible({ timeout: 5000 })
    await expect(window.getByRole('menuitem', { name: /hello/ })).toBeVisible()
  })

  test('renders a reconstructed diff card with +N −M and added/removed lines', async () => {
    const repoPath = createTestRepo('conductor-diff')
    await setupWorkspace(window, repoPath)

    const title = `diff-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      {
        kind: 'tool',
        id: 't1',
        callId: 't1',
        toolName: 'apply_patch',
        status: 'success',
        label: 'Edited foo.ts',
        createdAt: nowIso(),
        output: {
          kind: 'fileChange',
          files: [
            {
              path: 'foo.ts',
              patch:
                'diff --git a/foo.ts b/foo.ts\n' +
                'index 1111111..2222222 100644\n' +
                '--- a/foo.ts\n' +
                '+++ b/foo.ts\n' +
                '@@ -1,2 +1,2 @@\n' +
                ' const a = 1\n' +
                '-const b = 2\n' +
                '+const b = 3\n',
            },
          ],
        },
      },
    ])

    const row = window.getByTestId('diff-inline-row').first()
    await expect(row).toBeVisible({ timeout: 5000 })
    await expect(row).toContainText('Edit')
    await expect(row.getByTestId('cursor-diff-stat-add')).toHaveText('+1')
    await expect(row.getByTestId('cursor-diff-stat-del')).toHaveText('−1')
    const chip = window.getByTestId('diff-file-chip').first()
    await chip.hover()
    const popover = window.getByTestId('conductor-diff-hover-popover')
    await expect(popover).toBeVisible({ timeout: 3000 })
    await expect(popover.getByTestId('cursor-diff-popover-header')).toContainText('foo.ts')
    await expect(popover.getByTestId('conductor-diff-body')).toBeVisible()
    await row.click()
    await expect(window.getByTestId('cursor-diff-unlocked').first()).toBeVisible()
  })

  test('write tool shows a clickable file chip that opens the file tab', async () => {
    const repoPath = createTestRepo('conductor-write-chip')
    const { wsId } = await setupWorkspace(window, repoPath)
    const filePath = join(repoPath, 'src', 'hello.ts')
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(filePath, 'export const hello = 1\n')

    const title = `write-chip-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      {
        kind: 'tool',
        id: 'w1',
        callId: 'w1',
        toolName: 'write',
        status: 'success',
        label: 'Wrote src/hello.ts',
        createdAt: nowIso(),
        input: { path: 'src/hello.ts' },
      },
    ])

    const chip = window.getByRole('button', { name: 'Open src/hello.ts' })
    await expect(chip).toBeVisible({ timeout: 5000 })
    await expect(chip).toContainText('hello.ts')
    await chip.click()

    await expect
      .poll(async () =>
        window.evaluate((wsIdArg) => {
          const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
          return store.tabs.some(
            (tab: { type: string; workspaceId: string; filePath?: string }) =>
              tab.type === 'file' && tab.workspaceId === wsIdArg && tab.filePath?.endsWith('src/hello.ts'),
          )
        }, wsId),
      )
      .toBe(true)
  })

  test('write diff card exposes a clickable file chip separate from the collapse trigger', async () => {
    const repoPath = createTestRepo('conductor-write-diff-chip')
    await setupWorkspace(window, repoPath)

    const title = `write-diff-chip-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      {
        kind: 'tool',
        id: 'w1',
        callId: 'w1',
        toolName: 'write',
        status: 'success',
        label: 'Wrote foo.ts',
        createdAt: nowIso(),
        input: { path: 'foo.ts' },
        output: {
          kind: 'fileChange',
          files: [
            {
              path: 'foo.ts',
              patch:
                'diff --git a/foo.ts b/foo.ts\n' +
                'new file mode 100644\n' +
                '--- /dev/null\n' +
                '+++ b/foo.ts\n' +
                '@@ -0,0 +1,1 @@\n' +
                '+export const x = 1\n',
            },
          ],
        },
      },
    ])

    const row = window.getByTestId('diff-inline-row').first()
    await expect(row).toBeVisible({ timeout: 5000 })
    await expect(row).toContainText('Write')
    await expect(row.getByTestId('cursor-diff-stat-add')).toHaveText('+1')
    const chip = window.getByTestId('diff-file-chip').first()
    await chip.hover()
    await expect(window.getByTestId('conductor-diff-hover-popover')).toBeVisible({ timeout: 3000 })
    await expect(window.getByTestId('conductor-diff-body')).toBeVisible()
  })

  test('resolves Conductor file chips to shared non-default icon tokens', async () => {
    const repoPath = createTestRepo('conductor-file-icons')
    await setupWorkspace(window, repoPath)

    const title = `file-icons-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      {
        kind: 'tool',
        id: 'r1',
        callId: 'r1',
        toolName: 'read',
        status: 'success',
        label: 'Read src/index.ts',
        createdAt: nowIso(),
        input: { path: 'src/index.ts' },
        output: 'export const index = 1\n',
      },
      {
        kind: 'tool',
        id: 'r2',
        callId: 'r2',
        toolName: 'read',
        status: 'success',
        label: 'Read src/App.tsx',
        createdAt: nowIso(),
        input: { path: 'src/App.tsx' },
        output: 'export function App() { return null }\n',
      },
      {
        kind: 'tool',
        id: 'r3',
        callId: 'r3',
        toolName: 'read',
        status: 'success',
        label: 'Read README.md',
        createdAt: nowIso(),
        input: { path: 'README.md' },
        output: '# Test Repo\n',
      },
      {
        kind: 'tool',
        id: 'd1',
        callId: 'd1',
        toolName: 'apply_patch',
        status: 'success',
        label: 'Edited vite.config.ts',
        createdAt: nowIso(),
        output: {
          kind: 'fileChange',
          files: [
            {
              path: 'vite.config.ts',
              patch:
                'diff --git a/vite.config.ts b/vite.config.ts\n' +
                'new file mode 100644\n' +
                '--- /dev/null\n' +
                '+++ b/vite.config.ts\n' +
                '@@ -0,0 +1,1 @@\n' +
                '+export default {}\n',
            },
          ],
        },
      },
    ])

    const view = window.getByTestId('conductor-chat-view')
    await expect(view.locator('[data-file-icon-token="typescript"]').first()).toBeVisible({ timeout: 5000 })
    await expect(view.locator('[data-file-icon-token="react"]').first()).toBeVisible()
    await expect(view.locator('[data-file-icon-token="markdown"]').first()).toBeVisible()
    await expect(view.locator('[data-file-icon-token="vite"]').first()).toBeVisible()

    await window.getByRole('button', { name: 'Open vite.config.ts' }).hover()
    const popover = window.getByTestId('conductor-diff-hover-popover')
    await expect(popover).toBeVisible({ timeout: 3000 })
    await expect(popover.getByTestId('cursor-diff-popover-header')).toContainText('vite.config.ts')
    await expect(popover.locator('[data-file-icon-token="vite"]')).toBeVisible()
  })

  test('shows tool chips after expanding a latest completed turn summary', async () => {
    const repoPath = createTestRepo('conductor-tool-chips')
    await setupWorkspace(window, repoPath)

    const title = `tool-chips-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const tool = (id: string, toolName: string, label: string, input?: unknown) => ({
      kind: 'tool',
      id,
      callId: id,
      toolName,
      status: 'success',
      label,
      createdAt: nowIso(),
      ...(input ? { input } : {}),
    })
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'go', createdAt: nowIso() },
      tool('r1', 'read', 'Read 10 lines', { path: 'src/foo.ts' }),
      tool('b1', 'shell', 'npm test', 'npm test'),
      { kind: 'message', id: 'a1', role: 'assistant', text: 'done', createdAt: nowIso() },
    ])

    await window.getByTestId('turn-summary-header').click()
    await expect(window.getByTestId('cursor-tool-row').first()).toBeVisible({ timeout: 5000 })
    await expect(window.getByTestId('cursor-read-row')).toContainText('Read')
    await expect(window.getByTestId('cursor-bash-row')).toContainText('Bash')
    await expect(window.getByTestId('cursor-bash-chip')).toContainText('npm test')
  })

  test('groups consecutive assistant segments under one header', async () => {
    const repoPath = createTestRepo('conductor-assistant-group')
    await setupWorkspace(window, repoPath)

    const title = `assistant-group-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'plan it', createdAt: nowIso() },
      {
        kind: 'tool',
        id: 't1',
        callId: 't1',
        toolName: 'read',
        status: 'success',
        label: 'Read rules',
        createdAt: nowIso(),
      },
      { kind: 'message', id: 'a1', role: 'assistant', text: 'First segment.', createdAt: nowIso() },
      { kind: 'message', id: 'a2', role: 'assistant', text: 'Second segment.', createdAt: nowIso() },
    ])

    const assistantLabels = window.locator('[class*="messageRole"]').filter({ hasText: 'Assistant' })
    await expect(assistantLabels).toHaveCount(1)
    await expect(window.getByText('First segment.')).toBeVisible()
    await expect(window.getByText('Second segment.')).toBeVisible()
  })

  test('renders turn tool rows above assistant prose', async () => {
    const repoPath = createTestRepo('conductor-tools-above')
    await setupWorkspace(window, repoPath)

    const title = `tools-above-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'go', createdAt: nowIso() },
      {
        kind: 'tool',
        id: 't1',
        callId: 't1',
        toolName: 'read',
        status: 'success',
        label: 'Read 10 lines',
        createdAt: nowIso(),
      },
      { kind: 'message', id: 'a1', role: 'assistant', text: 'ANSWER_BELOW_TOOLS', createdAt: nowIso() },
    ])

    const summary = window.getByTestId('turn-summary-header')
    await expect(summary).toBeVisible({ timeout: 5000 })
    await expect(summary).toContainText('1 tool call')

    const summaryAboveAnswer = await window.evaluate(() => {
      const summaryHeader = document.querySelector('[data-testid="turn-summary-header"]')
      const answer = document.querySelector('[data-message-id="a1"]')
      if (!summaryHeader || !answer) return false
      return (summaryHeader.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    })
    expect(summaryAboveAnswer).toBe(true)

    await expect(window.getByTestId('cursor-tool-row')).toHaveCount(0)
    await summary.click()

    const toolsAboveAnswer = await window.evaluate(() => {
      const tool = document.querySelector('[data-testid="cursor-tool-row"]')
      const answer = document.querySelector('[data-message-id="a1"]')
      if (!tool || !answer) return false
      return (tool.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    })
    expect(toolsAboveAnswer).toBe(true)
  })

  test('groups assistant segments split by tool calls under one header', async () => {
    const repoPath = createTestRepo('conductor-assistant-split')
    await setupWorkspace(window, repoPath)

    const title = `assistant-split-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'plan it', createdAt: nowIso() },
      { kind: 'message', id: 'a1', role: 'assistant', text: 'Before tools.', createdAt: nowIso() },
      {
        kind: 'tool',
        id: 't1',
        callId: 't1',
        toolName: 'shell',
        status: 'success',
        label: 'Explored rules',
        createdAt: nowIso(),
      },
      { kind: 'message', id: 'a2', role: 'assistant', text: 'After tools.', createdAt: nowIso() },
    ])

    const assistantLabels = window.locator('[class*="messageRole"]').filter({ hasText: 'Assistant' })
    await expect(assistantLabels).toHaveCount(1)
    await expect(window.getByText('Before tools.')).toBeVisible()
    await expect(window.getByText('After tools.')).toBeVisible()
  })

  test('toggles markdown task checkboxes in assistant messages', async () => {
    const repoPath = createTestRepo('conductor-task-checkbox')
    await setupWorkspace(window, repoPath)

    const title = `task-checkbox-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'plan', createdAt: nowIso() },
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        text: '- [ ] First step\n- [x] Already done',
        createdAt: nowIso(),
      },
    ])

    const firstBox = window.locator('.cm-checkbox').first()
    await expect(firstBox).toBeVisible({ timeout: 5000 })
    await expect(firstBox).not.toBeChecked()
    await firstBox.click({ force: true })
    await expect(firstBox).toBeChecked()
  })

  test('shows and submits the plan approval footer only for completed plan messages', async () => {
    const repoPath = createTestRepo('conductor-plan-approval')
    await setupWorkspace(window, repoPath)

    const nonPlanSessionId = await createAndSelectSession(window, `non-plan-${Date.now()}`)
    await injectTranscript(app, nonPlanSessionId, [
      { kind: 'message', id: 'np-u1', role: 'user', text: 'answer directly', createdAt: nowIso() },
      { kind: 'message', id: 'np-a1', role: 'assistant', text: 'Direct answer.', createdAt: nowIso() },
    ])
    await expect(window.getByText('Direct answer.')).toBeVisible({ timeout: 5000 })
    await expect(window.getByRole('button', { name: 'Approve plan and continue' })).toHaveCount(0)

    const planSessionId = await createAndSelectSession(window, `plan-approval-${Date.now()}`, {
      plan: true,
    })
    await injectTranscript(app, planSessionId, [
      { kind: 'message', id: 'p-u1', role: 'user', text: 'make a plan', createdAt: nowIso() },
      {
        kind: 'message',
        id: 'p-a1',
        role: 'assistant',
        text: '## Plan\n- [ ] First step',
        createdAt: nowIso(),
      },
    ])

    await expect(window.getByRole('button', { name: 'Copy message' })).toBeVisible({ timeout: 5000 })
    await expect(window.getByRole('button', { name: 'Hand off from here' })).toBeVisible()
    const approve = window.getByRole('button', { name: 'Approve plan and continue' })
    await expect(approve).toBeVisible()
    await expect(approve).toContainText('Approve')
    await expect(approve).toContainText('⌘⇧↵')

    const session = await window.evaluate(async (sid: string) => {
      return await (
        window as unknown as { api: { agentChat: { getSession: (id: string) => Promise<{ state: Record<string, unknown> } | null> } } }
      ).api.agentChat.getSession(sid)
    }, planSessionId)
    expect(session?.state).toBeTruthy()
    await app.evaluate(
      ({ BrowserWindow }, { state }) => {
        const payload = { ...state, status: 'running' }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('agent-chat:state-changed', payload)
        }
      },
      { state: session!.state },
    )
    await expect(approve).toHaveCount(0)
    await app.evaluate(
      ({ BrowserWindow }, { state }) => {
        const payload = { ...state, status: 'idle' }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('agent-chat:state-changed', payload)
        }
      },
      { state: session!.state },
    )
    await expect(approve).toBeVisible({ timeout: 5000 })

    await approve.click()
    await expect(window.getByRole('button', { name: 'Plan mode on. Click to disable.' })).toHaveCount(0)
    await expect
      .poll(async () =>
        window.evaluate(async (sid: string) => {
          const sessionAfterSubmit = await (
            window as unknown as { api: { agentChat: { getSession: (id: string) => Promise<{ state: { plan?: boolean }; transcript: Array<{ kind: string; role?: string; text?: string }> } | null> } } }
          ).api.agentChat.getSession(sid)
          return {
            planOff: sessionAfterSubmit?.state.plan === false,
            approved: sessionAfterSubmit?.transcript.some(
              (item) =>
                item.kind === 'message' &&
                item.role === 'user' &&
                item.text === 'Approved. Please proceed with implementation.',
            ),
          }
        }, planSessionId),
      )
      .toEqual({ planOff: true, approved: true })
  })

  test('renders the live activity ticker for the active turn', async () => {
    const repoPath = createTestRepo('conductor-ticker')
    await setupWorkspace(window, repoPath)

    const title = `ticker-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'do it', createdAt: nowIso() },
      {
        kind: 'tool',
        id: 'r1',
        callId: 'r1',
        toolName: 'read',
        status: 'success',
        label: 'Read 10 lines',
        createdAt: nowIso(),
      },
      { kind: 'activity', id: 'w1', label: 'Working…', createdAt: nowIso() },
    ])

    await expect(window.locator('[class*="ticker"]').first()).toBeVisible({ timeout: 5000 })
  })

  test('places working activity after assistant prose within a turn', async () => {
    const repoPath = createTestRepo('conductor-working-order')
    await setupWorkspace(window, repoPath)

    const title = `working-order-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'go', createdAt: nowIso() },
      { kind: 'activity', id: 'w1', label: 'Working…', createdAt: nowIso() },
      {
        kind: 'tool',
        id: 'r1',
        callId: 'r1',
        toolName: 'read',
        status: 'success',
        label: 'Read 10 lines',
        createdAt: nowIso(),
      },
      { kind: 'message', id: 'a1', role: 'assistant', text: 'ANSWER_BEFORE_TICKER', createdAt: nowIso() },
    ])

    const assistantBeforeTicker = await window.evaluate(() => {
      const assistant = document.querySelector('[data-message-id="a1"]')
      const ticker = document.querySelector('[class*="ticker"]')
      if (!assistant || !ticker) return false
      return (assistant.compareDocumentPosition(ticker) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    })
    expect(assistantBeforeTicker).toBe(true)
  })

  test('shows Stop (Esc) on the stop button while the session is running', async () => {
    const repoPath = createTestRepo('conductor-stop-hint')
    await setupWorkspace(window, repoPath)

    const title = `stop-hint-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const session = await window.evaluate(async (sid: string) => {
      return await (
        window as unknown as { api: { agentChat: { getSession: (id: string) => Promise<{ state: { sessionId: string; workspaceId: string; workspacePath: string; provider: string; model: string; title: string; plan: boolean; thinkingLevel: string; status: string } } | null> } } }
      ).api.agentChat.getSession(sid)
    }, sessionId)
    expect(session?.state).toBeTruthy()
    await app.evaluate(
      ({ BrowserWindow }, { state }) => {
        const payload = { ...state, status: 'running' as const }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('agent-chat:state-changed', payload)
        }
      },
      { state: session!.state },
    )

    await expect(window.getByRole('button', { name: 'Stop' })).toHaveAttribute('title', 'Stop (Esc)', {
      timeout: 5000,
    })
  })

  test('Escape while running invokes agent cancel', async () => {
    const repoPath = createTestRepo('conductor-esc-cancel')
    await setupWorkspace(window, repoPath)

    const title = `esc-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const session = await window.evaluate(async (sid: string) => {
      return await (
        window as unknown as { api: { agentChat: { getSession: (id: string) => Promise<{ state: Record<string, unknown> } | null> } } }
      ).api.agentChat.getSession(sid)
    }, sessionId)
    expect(session?.state).toBeTruthy()

    await app.evaluate(
      ({ BrowserWindow }, { state }) => {
        const payload = { ...state, status: 'running' }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('agent-chat:state-changed', payload)
        }
      },
      { state: session!.state },
    )

    await app.evaluate(() => {
      ;(globalThis as { __agentChatCancelCount?: number }).__agentChatCancelCount = 0
    })

    await window.getByPlaceholder('Ask to make changes').focus()
    await window.keyboard.press('Escape')

    await expect
      .poll(async () =>
        app.evaluate(() => (globalThis as { __agentChatCancelCount?: number }).__agentChatCancelCount ?? 0),
      )
      .toBeGreaterThan(0)
  })

  test('cursor tool rows are transparent with bordered file chips', async () => {
    const repoPath = createTestRepo('conductor-cursor-row-chrome')
    await setupWorkspace(window, repoPath)

    const title = `cursor-chrome-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      {
        kind: 'tool',
        id: 't1',
        callId: 't1',
        toolName: 'apply_patch',
        status: 'success',
        label: 'Edited foo.ts',
        createdAt: nowIso(),
        output: {
          kind: 'fileChange',
          files: [
            {
              path: 'foo.ts',
              patch:
                'diff --git a/foo.ts b/foo.ts\n' +
                'index 1111111..2222222 100644\n' +
                '--- a/foo.ts\n' +
                '+++ b/foo.ts\n' +
                '@@ -1,2 +1,2 @@\n' +
                ' const a = 1\n' +
                '-const b = 2\n' +
                '+const b = 3\n',
            },
          ],
        },
      },
      {
        kind: 'tool',
        id: 'l1',
        callId: 'l1',
        toolName: 'list',
        status: 'success',
        label: 'Listed src',
        createdAt: nowIso(),
        input: { path: 'src' },
      },
    ])

    const row = window.getByTestId('cursor-tool-row').first()
    await expect(row).toBeVisible({ timeout: 5000 })
    const rowBg = await row.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(rowBg === 'transparent' || rowBg === 'rgba(0, 0, 0, 0)').toBeTruthy()

    const fileChip = window.getByTestId('diff-file-chip').first()
    const chipBorder = await fileChip.evaluate((el) => getComputedStyle(el).borderWidth)
    expect(chipBorder).toBe('1px')

    const dirChip = window.getByTestId('cursor-dir-chip')
    await expect(dirChip).toBeVisible()
    const dirBorder = await dirChip.evaluate((el) => getComputedStyle(el).borderWidth)
    expect(dirBorder).toBe('0px')
  })

  test('left-aligns the turn summary with the chat column', async () => {
    const repoPath = createTestRepo('conductor-turn-align')
    await setupWorkspace(window, repoPath)

    const title = `turn-align-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const tool = (id: string, label: string) => ({
      kind: 'tool',
      id,
      callId: id,
      toolName: 'shell',
      status: 'success',
      label,
      createdAt: nowIso(),
    })
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'go', createdAt: nowIso() },
      tool('x1', 'ran a'),
      tool('x2', 'ran b'),
      { kind: 'message', id: 'a1', role: 'assistant', text: 'done', createdAt: nowIso() },
    ])

    await expect(window.locator('[class*="turnSummaryHeader"]').first()).toBeVisible({ timeout: 5000 })
    const leftAligned = await window.evaluate(() => {
      const summary = document.querySelector('[class*="turnSummary"]:not([class*="turnSummaryEdge"]):not([class*="turnSummaryHeader"]):not([class*="turnSummaryBody"]):not([class*="turnSummaryLabel"])') as HTMLElement | null
      const header = document.querySelector('[class*="turnSummaryHeader"]') as HTMLElement | null
      if (!summary || !header) return { ok: false, summaryAlign: null, headerAlign: null }
      const summaryAlign = getComputedStyle(summary).alignItems
      const headerAlign = getComputedStyle(header).textAlign
      const ok =
        (summaryAlign === 'flex-start' || summaryAlign === 'start') &&
        (headerAlign === 'left' || headerAlign === 'start')
      return { ok, summaryAlign, headerAlign }
    })
    expect(leftAligned.ok).toBe(true)
  })

  test('renders an INTERRUPTED BY USER pill for a Stopped event', async () => {
    const repoPath = createTestRepo('conductor-stop')
    await setupWorkspace(window, repoPath)

    const title = `stop-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    await injectTranscript(app, sessionId, [
      { kind: 'activity', id: 's1', label: 'Stopped', createdAt: nowIso() },
    ])

    await expect(window.locator('[class*="interruptPill"]')).toBeVisible({ timeout: 5000 })
    await expect(window.locator('[class*="interruptPill"]')).toContainText('INTERRUPTED BY USER')
  })

  test('collapses completed latest-turn tool rows behind turn summary', async () => {
    const repoPath = createTestRepo('conductor-latest-collapse')
    await setupWorkspace(window, repoPath)

    const title = `latest-collapse-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const tool = (id: string, label: string) => ({
      kind: 'tool',
      id,
      callId: id,
      toolName: 'shell',
      status: 'success',
      label,
      createdAt: nowIso(),
    })
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'only turn', createdAt: nowIso() },
      tool('x1', 'ran a'),
      tool('x2', 'ran b'),
      { kind: 'message', id: 'a1', role: 'assistant', text: 'DONE', createdAt: nowIso() },
    ])

    await expect(window.locator('[class*="turnSummaryHeader"]').first()).toBeVisible({ timeout: 5000 })
    await expect(window.locator('[class*="turnSummaryHeader"]').first()).toContainText('2 tool calls')
    await expect(window.getByTestId('cursor-tool-row')).toHaveCount(0)
    await expect(window.getByText('DONE')).toBeVisible()
    await window.getByTestId('turn-summary-header').click()
    await expect(window.getByTestId('cursor-tool-row')).toHaveCount(2)
  })

  test('deletes persisted session data when the conductor tab is closed', async () => {
    const repoPath = createTestRepo('conductor-tab-close')
    await setupWorkspace(window, repoPath)

    const title = `close-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)

    const listedBefore = await window.evaluate(async (sid: string) => {
      const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
      const sessions = await (
        window as unknown as { api: { agentChat: { listSessions: (ws: string) => Promise<Array<{ sessionId: string }>> } } }
      ).api.agentChat.listSessions(store.activeWorkspaceId)
      return sessions.some((s) => s.sessionId === sid)
    }, sessionId)
    expect(listedBefore).toBe(true)

    await window.evaluate((sid: string) => {
      const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
      const tab = store.tabs.find(
        (t: { type?: string; agentSessionId?: string; id: string }) =>
          t.type === 'conductor' && t.agentSessionId === sid,
      )
      if (tab) store.removeTab(tab.id)
    }, sessionId)

    await window.waitForTimeout(250)

    const listedAfter = await window.evaluate(async (sid: string) => {
      const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
      const sessions = await (
        window as unknown as { api: { agentChat: { listSessions: (ws: string) => Promise<Array<{ sessionId: string }>> } } }
      ).api.agentChat.listSessions(store.activeWorkspaceId)
      return sessions.some((s) => s.sessionId === sid)
    }, sessionId)
    expect(listedAfter).toBe(false)
  })

  test('keeps earlier-turn assistant answers visible when collapsing tool rows', async () => {
    const repoPath = createTestRepo('conductor-collapse')
    await setupWorkspace(window, repoPath)

    const title = `collapse-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)
    const tool = (id: string, label: string) => ({
      kind: 'tool',
      id,
      callId: id,
      toolName: 'shell',
      status: 'success',
      label,
      createdAt: nowIso(),
    })
    await injectTranscript(app, sessionId, [
      { kind: 'message', id: 'u1', role: 'user', text: 'first question', createdAt: nowIso() },
      tool('x1', 'ran a'),
      tool('x2', 'ran b'),
      tool('x3', 'ran c'),
      { kind: 'message', id: 'a1', role: 'assistant', text: 'EARLIERANSWER', createdAt: nowIso() },
      { kind: 'message', id: 'u2', role: 'user', text: 'second question', createdAt: nowIso() },
      { kind: 'message', id: 'a2', role: 'assistant', text: 'LATESTANSWER', createdAt: nowIso() },
    ])

    // The earlier turn's tool rows collapse behind a summary, but its answer stays visible.
    await expect(window.locator('[class*="turnSummaryHeader"]').first()).toBeVisible({ timeout: 5000 })
    await expect(window.locator('[class*="turnSummaryHeader"]').first()).toContainText('3 tool calls')
    await expect(window.getByText('EARLIERANSWER')).toBeVisible()
    await expect(window.getByText('LATESTANSWER')).toBeVisible()
  })

  test('does not re-pin timeline scroll after the user scrolls up and transcript grows', async () => {
    const repoPath = createTestRepo('conductor-scroll-pin')
    await setupWorkspace(window, repoPath)

    const title = `scroll-pin-${Date.now()}`
    const sessionId = await createAndSelectSession(window, title)

    const filler = 'scroll-filler-line with extra content\n'.repeat(40)
    const baseTranscript = Array.from({ length: 12 }, (_, index) => [
      {
        kind: 'message',
        id: `u-${index}`,
        role: 'user',
        text: `Question ${index}\n${filler}`,
        createdAt: nowIso(),
      },
      {
        kind: 'message',
        id: `a-${index}`,
        role: 'assistant',
        text: `Answer ${index}\n${filler}`,
        createdAt: nowIso(),
      },
    ]).flat()

    await injectTranscript(app, sessionId, baseTranscript)
    await expect(window.getByText('Answer 0')).toBeVisible({ timeout: 5000 })
    await window.waitForTimeout(200)

    const scrollAway = await window.evaluate(() => {
      const el = document.querySelector(
        '[class*="timelineWrap"] > [class*="timeline"]',
      ) as HTMLElement | null
      if (!el) return null
      const maxScrollTop = el.scrollHeight - el.clientHeight
      if (maxScrollTop <= 80) {
        return { scrollTop: el.scrollTop, maxScrollTop, scrollable: false }
      }
      el.scrollTop = Math.floor(maxScrollTop / 2)
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
      el.dispatchEvent(new Event('scroll', { bubbles: true }))
      return {
        scrollTop: el.scrollTop,
        maxScrollTop,
        scrollable: true,
      }
    })
    expect(scrollAway).not.toBeNull()
    if (!scrollAway) return
    expect(scrollAway.scrollable).toBe(true)
    expect(scrollAway.scrollTop).toBeLessThan(scrollAway.maxScrollTop - 80)

    const extendedTranscript = [
      ...baseTranscript,
      {
        kind: 'message',
        id: 'u-extra',
        role: 'user',
        text: `Question extra\n${filler}`,
        createdAt: nowIso(),
      },
      {
        kind: 'message',
        id: 'a-extra',
        role: 'assistant',
        text: `Answer extra\n${filler}`,
        createdAt: nowIso(),
      },
    ]
    await injectTranscript(app, sessionId, extendedTranscript)
    await expect(window.getByText('Answer extra')).toBeVisible({ timeout: 5000 })

    const scrollAfterGrowth = await window.evaluate(() => {
      const el = document.querySelector(
        '[class*="timelineWrap"] > [class*="timeline"]',
      ) as HTMLElement | null
      if (!el) return null
      return {
        scrollTop: el.scrollTop,
        maxScrollTop: el.scrollHeight - el.clientHeight,
      }
    })
    expect(scrollAfterGrowth).not.toBeNull()
    if (!scrollAfterGrowth) return
    expect(scrollAfterGrowth.scrollTop).toBeLessThan(scrollAfterGrowth.maxScrollTop - 80)
    expect(Math.abs(scrollAfterGrowth.scrollTop - scrollAway.scrollTop)).toBeLessThan(48)
  })
})
