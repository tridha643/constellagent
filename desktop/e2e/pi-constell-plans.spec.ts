import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { homedir, tmpdir } from 'os'

const appPath = resolve(__dirname, '../out/main/index.js')
const PI_CONSTELL_DIR = join(homedir(), '.pi-constell', 'plans')
const PI_MODELS_STDOUT = `
Using ~/.pi/config.json
provider      model                 aliases
------------  --------------------  -------
anthropic     claude-sonnet-4-5     default
google        gemini-2-5-pro
anthropic     claude-sonnet-4-5     latest
`
const PI_CONSTELL_PLAN_BODY = `---
constellagent:
  built: false
  codingAgent: "anthropic/claude-sonnet-4-5"
  buildHarness: "pi-constell"
---
# Improve plan mode questionnaire UX

## Open Questions / Assumptions
- Scope: Hardening.

## Phases

### Phase 1
Goal: Enforce a clarification gate.

Why this phase boundary makes sense: It lands the core safety behavior first.

Main code areas:
- extensions
- tests
- docs

Task breakdown:
- Add coverage for write blocking and prompt instructions.

Tests:
- Run package verify and confirm askUserQuestion is mandatory.

How I'll validate:
- Confirm the plan is saved under ~/.pi-constell/plans.

### Phase 2
Goal: Confirm later phases remain visible in the app.

Why this phase boundary makes sense: Preview rendering should show the full saved plan.

Main code areas:
- desktop

Task breakdown:
- Open the saved PI plan in preview.

Tests:
- Run the PI Constell desktop e2e.

How I'll validate:
- Confirm Phase 2 renders after Phase 1.

## Recommendation
- Start with Phase 1.
`

const PI_CONSTELL_SHORT_PLAN_BODY = `---
constellagent:
  built: false
---
# Short PI Plan

Alpha
Beta
`

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [appPath], env: { ...process.env, CI_TEST: '1' } })
async function launchApp(
  envOverrides: Record<string, string | undefined> = {},
): Promise<{ app: ElectronApplication; window: Page }> {
  const env: Record<string, string> = { ...process.env, CI_TEST: '1' } as Record<string, string>
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }

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

function createUserDataPath(name: string): string {
  return mkdtempSync(join(tmpdir(), `constellagent-${name}-`))
}

async function setupWorkspace(window: Page, repoPath: string) {
  return await window.evaluate(async (repo: string) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })

    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

    const worktreePath = await (window as any).api.git.createWorktree(repo, 'ws-pi-constell', 'branch-pi-constell', true)

    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId,
      name: 'ws-pi-constell',
      branch: 'branch-pi-constell',
      worktreePath,
      projectId,
    })

    return { worktreePath, wsId }
  }, repoPath)
}

async function openPlan(window: Page, planPath: string) {
  await window.evaluate((filePath: string) => {
    const store = (window as any).__store.getState()
    store.openMarkdownPreview(filePath)
  }, planPath)

  await window.waitForFunction((expectedPath) => {
    const s = (window as any).__store.getState()
    const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
    return tab?.type === 'markdownPreview' && tab?.filePath === expectedPath
  }, planPath)
}

async function reopenPlan(window: Page, planPath: string) {
  await window.evaluate((filePath: string) => {
    const store = (window as any).__store.getState()
    if (store.activeTabId) store.removeTab(store.activeTabId)
    store.openMarkdownPreview(filePath)
  }, planPath)

  await window.waitForFunction((expectedPath) => {
    const s = (window as any).__store.getState()
    const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
    return tab?.type === 'markdownPreview' && tab?.filePath === expectedPath
  }, planPath)
}

function createPiConstellPlan(fileName: string): string {
  mkdirSync(PI_CONSTELL_DIR, { recursive: true })
  const planPath = join(PI_CONSTELL_DIR, fileName)
  writeFileSync(planPath, PI_CONSTELL_PLAN_BODY)
  return planPath
}

test.describe('PI Constell plan discovery', () => {
  test('Cmd+Shift+M palette lists and filters PI Constell plans', async () => {
    const repoPath = createTestRepo('pi-constell-plan-palette')
    const { app, window } = await launchApp()
    const piConstellPlan = join(PI_CONSTELL_DIR, `pi-constell-plan-${Date.now()}.md`)

    try {
      const { worktreePath } = await setupWorkspace(window, repoPath)
      const cursorDir = join(worktreePath, '.cursor', 'plans')
      mkdirSync(PI_CONSTELL_DIR, { recursive: true })
      mkdirSync(cursorDir, { recursive: true })

      const cursorPlan = join(cursorDir, 'cursor-plan.md')
      writeFileSync(piConstellPlan, PI_CONSTELL_PLAN_BODY)
      writeFileSync(cursorPlan, '# Cursor plan\n')
      const now = new Date()
      utimesSync(piConstellPlan, now, now)
      utimesSync(cursorPlan, new Date(now.getTime() - 60_000), new Date(now.getTime() - 60_000))

      await window.keyboard.press('Meta+Shift+M')
      await window.waitForTimeout(700)

      await expect(window.getByPlaceholder('Search plans by name...')).toBeVisible()
      const planFilters = window.getByRole('group', { name: 'Plan filters' })
      await expect(planFilters.getByRole('button', { name: 'PI Constell', exact: true })).toBeVisible()
      await expect(window.getByText(piConstellPlan.split('/').pop()!, { exact: true })).toBeVisible()
      await expect(window.getByText('cursor-plan.md', { exact: true })).toBeVisible()

      await planFilters.getByRole('button', { name: 'PI Constell', exact: true }).click()
      await window.waitForTimeout(300)

      await expect(window.getByText(piConstellPlan.split('/').pop()!, { exact: true })).toBeVisible()
      await expect(window.getByText('cursor-plan.md', { exact: true })).toHaveCount(0)
    } finally {
      rmSync(piConstellPlan, { force: true })
      await app.close()
    }
  })

  test('Plans button opens newest PI Constell plan', async () => {
    const repoPath = createTestRepo('pi-constell-plan-button')
    const { app, window } = await launchApp()
    const piConstellPlan = join(PI_CONSTELL_DIR, `newest-pi-constell-plan-${Date.now()}.md`)

    try {
      const { worktreePath } = await setupWorkspace(window, repoPath)
      const claudeDir = join(worktreePath, '.claude', 'plans')
      mkdirSync(PI_CONSTELL_DIR, { recursive: true })
      mkdirSync(claudeDir, { recursive: true })

      const claudePlan = join(claudeDir, 'older-claude-plan.md')
      writeFileSync(claudePlan, '# Older Claude plan\n')
      writeFileSync(piConstellPlan, PI_CONSTELL_PLAN_BODY)
      const now = new Date()
      utimesSync(claudePlan, new Date(now.getTime() - 120_000), new Date(now.getTime() - 120_000))
      utimesSync(piConstellPlan, now, now)

      await window.getByRole('button', { name: /Plans/ }).click()
      await window.waitForFunction((expectedPath) => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
        return tab?.type === 'markdownPreview' && tab?.filePath === expectedPath
      }, piConstellPlan)

      const active = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
        return { type: tab?.type, filePath: tab?.filePath }
      })
      expect(active).toEqual({ type: 'markdownPreview', filePath: piConstellPlan })
      await expect(window.getByText('Phase 1', { exact: true })).toBeVisible()
      await expect(window.getByText('Phase 2', { exact: true })).toBeVisible()
      await expect(window.getByText('constellagent:', { exact: false })).toHaveCount(0)
    } finally {
      rmSync(piConstellPlan, { force: true })
      await app.close()
    }
  })

  test('Cmd+L on plan preview opens a PI sidecar and seeds edit-file context', async () => {
    const repoPath = createTestRepo('pi-constell-plan-preview-cmdl')
    const { app, window } = await launchApp()
    const piConstellDir = join(homedir(), '.pi-constell', 'plans')
    const piConstellPlan = join(piConstellDir, `preview-cmdl-${Date.now()}.md`)

    try {
      await setupWorkspace(window, repoPath)
      mkdirSync(piConstellDir, { recursive: true })
      writeFileSync(piConstellPlan, PI_CONSTELL_SHORT_PLAN_BODY)

      await window.evaluate((planPath: string) => {
        const store = (window as any).__store.getState()
        store.openMarkdownPreview(planPath)
      }, piConstellPlan)
      const previewHeading = window.getByText('Short PI Plan')
      await expect(previewHeading).toBeVisible({ timeout: 10000 })
      await previewHeading.click()

      await window.evaluate(() => {
        const target = (document.activeElement as HTMLElement | null) ?? document.body
        target.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'l',
          code: 'KeyL',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }))
      })
      await window.waitForTimeout(6000)

      const result = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
        return {
          tabType: tab?.type,
          fileLeafPath: tab?.splitRoot?.children?.[0]?.filePath,
          terminalLeafType: tab?.splitRoot?.children?.[1]?.contentType,
          title: tab?.title,
          bodyText: document.body.innerText,
        }
      })

      expect(result.tabType).toBe('terminal')
      expect(result.fileLeafPath).toBe(piConstellPlan)
      expect(result.terminalLeafType).toBe('terminal')
      expect(result.title).toContain('π -')
      expect(result.bodyText).toContain('[paste #1 +')
      expect(result.bodyText).toContain('Short PI Plan')
    } finally {
      rmSync(piConstellPlan, { force: true })
  test('PI toolbar lists cached/runtime models and persists the selected raw model id', async () => {
    const repoPath = createTestRepo('pi-constell-toolbar')
    const userDataPath = createUserDataPath('pi-models-toolbar')
    const { app, window } = await launchApp({
      CONSTELLAGENT_USER_DATA_PATH: userDataPath,
      CONSTELLAGENT_PI_MODELS_STDOUT: undefined,
      CONSTELLAGENT_PI_MODELS_STDERR: PI_MODELS_STDOUT,
    })
    const piConstellPlan = createPiConstellPlan(`pi-constell-toolbar-${Date.now()}.md`)

    try {
      await setupWorkspace(window, repoPath)
      await openPlan(window, piConstellPlan)

      const modelSelect = window.getByTitle('Model for selected harness (value is the CLI --model id)')
      await expect(modelSelect).toHaveValue('anthropic/claude-sonnet-4-5')
      await expect.poll(async () => {
        return modelSelect.locator('option').allTextContents()
      }).toContain('google / gemini-2-5-pro (google/gemini-2-5-pro)')

      const optionTexts = await modelSelect.locator('option').allTextContents()
      expect(optionTexts).toContain('anthropic / claude-sonnet-4-5 (anthropic/claude-sonnet-4-5)')
      expect(optionTexts).toContain('google / gemini-2-5-pro (google/gemini-2-5-pro)')
      expect(optionTexts.filter((text) => text === 'anthropic / claude-sonnet-4-5 (anthropic/claude-sonnet-4-5)')).toHaveLength(1)

      await modelSelect.selectOption('google/gemini-2-5-pro')
      const updatedMeta = await window.evaluate((filePath: string) => {
        return (window as any).api.fs.readPlanMeta(filePath)
      }, piConstellPlan)
      expect(updatedMeta.codingAgent).toBe('google/gemini-2-5-pro')

      await reopenPlan(window, piConstellPlan)
      const reopenedModelSelect = window.getByTitle('Model for selected harness (value is the CLI --model id)')
      await expect(reopenedModelSelect).toHaveValue('google/gemini-2-5-pro')

      const cache = JSON.parse(readFileSync(join(userDataPath, 'pi-models-cache.json'), 'utf-8')) as {
        models: Array<{ id: string }>
      }
      expect(cache.models.map((model) => model.id)).toEqual([
        'anthropic/claude-sonnet-4-5',
        'google/gemini-2-5-pro',
      ])
    } finally {
      rmSync(piConstellPlan, { force: true })
      rmSync(userDataPath, { recursive: true, force: true })
      await app.close()
    }
  })

  test('Cmd+L on plan editor source preserves selection in the seeded payload', async () => {
    const repoPath = createTestRepo('pi-constell-plan-editor-cmdl')
    const { app, window } = await launchApp()
    const piConstellDir = join(homedir(), '.pi-constell', 'plans')
    const piConstellPlan = join(piConstellDir, `editor-cmdl-${Date.now()}.md`)

    try {
      await setupWorkspace(window, repoPath)
      mkdirSync(piConstellDir, { recursive: true })
      writeFileSync(piConstellPlan, PI_CONSTELL_SHORT_PLAN_BODY)

      await window.evaluate((planPath: string) => {
        const store = (window as any).__store.getState()
        const wsId = store.activeWorkspaceId
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId: wsId,
          type: 'file',
          filePath: planPath,
        })
      }, piConstellPlan)

      await window.getByRole('button', { name: 'Source', exact: true }).click()
      const monacoEditor = window.locator('.monaco-editor').first()
      await expect(monacoEditor).toBeVisible({ timeout: 10000 })

      const alphaLine = window.locator('.view-line', { hasText: 'Alpha' }).first()
      await expect(alphaLine).toBeVisible({ timeout: 10000 })
      await alphaLine.dblclick()
      await window.keyboard.press('Meta+l')

      await window.waitForTimeout(6000)

      const result = await window.evaluate((planPath: string) => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
        return {
          tabType: tab?.type,
          title: tab?.title,
          hasPlanFileLeaf: tab?.splitRoot?.children?.some?.((child: any) => child.contentType === 'file' && child.filePath === planPath),
          bodyText: document.body.innerText,
        }
      }, piConstellPlan)
      const compactBody = result.bodyText.replace(/\s+/g, '')
      expect(result.tabType).toBe('terminal')
      expect(result.hasPlanFileLeaf).toBe(true)
      expect(result.title).toContain('π -')
      expect(result.bodyText).toContain('[edit_file]')
      expect(compactBody).toContain(`@${piConstellPlan}:7`)
      expect(result.bodyText).toContain('Alpha')
    } finally {
      rmSync(piConstellPlan, { force: true })
  test('PI toolbar keeps rendering cached models when runtime listing is unavailable', async () => {
    const repoPath = createTestRepo('pi-constell-cache-fallback')
    const userDataPath = createUserDataPath('pi-models-cache')
    const piConstellPlan = createPiConstellPlan(`pi-constell-cache-${Date.now()}.md`)

    const seeded = await launchApp({
      CONSTELLAGENT_USER_DATA_PATH: userDataPath,
      CONSTELLAGENT_PI_MODELS_STDOUT: PI_MODELS_STDOUT,
    })
    try {
      const models = await seeded.window.evaluate(async () => {
        return (window as any).api.app.listPiModels()
      })
      expect(models.map((model: { id: string }) => model.id)).toEqual([
        'anthropic/claude-sonnet-4-5',
        'google/gemini-2-5-pro',
      ])
    } finally {
      await seeded.app.close()
    }

    const { app, window } = await launchApp({
      CONSTELLAGENT_USER_DATA_PATH: userDataPath,
      CONSTELLAGENT_PI_MODELS_ERROR: 'pi unavailable',
      CONSTELLAGENT_PI_MODELS_STDOUT: undefined,
    })

    try {
      await setupWorkspace(window, repoPath)
      await openPlan(window, piConstellPlan)

      const modelSelect = window.getByTitle('Model for selected harness (value is the CLI --model id)')
      await expect.poll(async () => {
        return modelSelect.locator('option').allTextContents()
      }).toContain('google / gemini-2-5-pro (google/gemini-2-5-pro)')
      const optionTexts = await modelSelect.locator('option').allTextContents()
      expect(optionTexts).toContain('anthropic / claude-sonnet-4-5 (anthropic/claude-sonnet-4-5)')
      expect(optionTexts).toContain('google / gemini-2-5-pro (google/gemini-2-5-pro)')
      expect(optionTexts).not.toContain('PI models unavailable')
    } finally {
      rmSync(piConstellPlan, { force: true })
      rmSync(userDataPath, { recursive: true, force: true })
      await app.close()
    }
  })
})
