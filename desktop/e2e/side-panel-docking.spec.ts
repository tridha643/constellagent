import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, mkdtempSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

type WorkspaceSeed = {
  name: string
  branch: string
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
  mkdirSync(join(repoPath, 'src'), { recursive: true })
  writeFileSync(join(repoPath, 'src/index.ts'), 'console.log("hello world")\n')
  writeFileSync(join(repoPath, 'src/utils.ts'), 'export const sum = (a: number, b: number) => a + b\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function createUserDataPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), `constellagent-${name}-`)), 'user-data')
}

function cleanupTestRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) {
      rmSync(repoPath, { recursive: true, force: true })
    }
    const parentDir = resolve(repoPath, '..')
    const repoName = repoPath.split('/').pop()
    if (repoName) {
      const entries = readdirSync(parentDir)
      for (const entry of entries) {
        if (entry.startsWith(`${repoName}-ws-`)) {
          rmSync(join(parentDir, entry), { recursive: true, force: true })
        }
      }
    }
  } catch {
    // best effort
  }
}

async function setupProject(window: Page, repoPath: string, workspaces: WorkspaceSeed[]): Promise<void> {
  await window.evaluate(async ({ repo, seeds }: { repo: string; seeds: WorkspaceSeed[] }) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [], tabs: [] })
    store.resetSidePanelLayout()
    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'dock-test-project', repoPath: repo })

    for (const seed of seeds) {
      const worktreePath = await (window as any).api.git.createWorktree(repo, seed.name, seed.branch, true)
      store.addWorkspace({
        id: crypto.randomUUID(),
        name: seed.name,
        branch: seed.branch,
        worktreePath,
        projectId,
      })
    }
  }, { repo: repoPath, seeds: workspaces })
}

async function dispatchDrag(window: Page, sourceSelector: string, targetSelector: string): Promise<void> {
  await window.evaluate(async ({ sourceSelector: source, targetSelector: target }) => {
    const sourceEl = document.querySelector(source) as HTMLElement | null
    if (!sourceEl) throw new Error(`Missing drag source: ${source}`)

    const dataTransfer = new DataTransfer()
    sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))

    const targetEl = document.querySelector(target) as HTMLElement | null
    if (!targetEl) throw new Error(`Missing drop target: ${target}`)

    targetEl.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }))
    targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    targetEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }))
  }, { sourceSelector, targetSelector })
}

async function dispatchDragByText(window: Page, scopeSelector: string, sourceText: string, targetText: string): Promise<void> {
  await window.evaluate(({ scopeSelector: scopeQuery, sourceText: sourceNeedle, targetText: targetNeedle }) => {
    const scope = document.querySelector(scopeQuery) as HTMLElement | null
    if (!scope) throw new Error(`Missing drag scope: ${scopeQuery}`)

    const candidates = Array.from(scope.querySelectorAll<HTMLElement>('[draggable="true"]'))
    const source = candidates.find((el) => el.textContent?.includes(sourceNeedle))
    const target = candidates.find((el) => el.textContent?.includes(targetNeedle))
    if (!source) throw new Error(`Missing draggable source text: ${sourceNeedle}`)
    if (!target) throw new Error(`Missing draggable target text: ${targetNeedle}`)

    const dataTransfer = new DataTransfer()
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }))
  }, { scopeSelector, sourceText, targetText })
}

test.describe('side panel docking', () => {
  test('supports docking supported panels in both directions', async () => {
    const repoPath = createTestRepo('panel-dock-both-directions')
    const userDataPath = createUserDataPath('side-panel-both-directions')
    const { app, window } = await launchApp(userDataPath)

    try {
      await setupProject(window, repoPath, [{ name: 'ws-dock', branch: 'branch-dock' }])
      await window.waitForTimeout(1200)

      await dispatchDrag(window, '[data-panel-side="right"] [data-panel-type="files"]', '[data-panel-drop-target-side="left"]')
      await window.waitForTimeout(300)

      let sidePanels = await window.evaluate(() => (window as any).__store.getState().sidePanels)
      expect(sidePanels.left.panelOrder).toEqual(['project', 'files'])
      expect(sidePanels.left.activePanel).toBe('files')
      expect(sidePanels.right.panelOrder).toEqual(['changes', 'graph'])

      await dispatchDrag(window, '[data-panel-side="left"] [data-panel-type="project"]', '[data-panel-drop-target-side="right"]')
      await window.waitForTimeout(300)

      sidePanels = await window.evaluate(() => (window as any).__store.getState().sidePanels)
      expect(sidePanels.left.panelOrder).toEqual(['files'])
      expect(sidePanels.right.panelOrder).toEqual(['changes', 'graph', 'project'])
      expect(sidePanels.right.activePanel).toBe('project')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  test('restores docked panels after dropping into a collapsed sidebar edge and restarting', async () => {
    const repoPath = createTestRepo('panel-dock-persist')
    const userDataPath = createUserDataPath('side-panel-persist')
    let app: ElectronApplication | null = null
    let window: Page | null = null

    try {
      ;({ app, window } = await launchApp(userDataPath))
      await setupProject(window, repoPath, [{ name: 'ws-persist', branch: 'branch-persist' }])
      await window.waitForTimeout(1200)

      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.toggleSidebar()
      })
      await window.waitForTimeout(200)
      await expect(window.getByTestId('side-panel-left')).not.toBeVisible()

      await dispatchDrag(window, '[data-panel-side="right"] [data-panel-type="changes"]', '[data-testid="panel-dock-edge-left"]')
      await window.waitForTimeout(300)

      let sidePanels = await window.evaluate(() => (window as any).__store.getState().sidePanels)
      expect(sidePanels.left.open).toBe(true)
      expect(sidePanels.left.panelOrder).toEqual(['project', 'changes'])
      expect(sidePanels.left.activePanel).toBe('changes')

      await window.evaluate(async () => {
        const state = (window as any).__store.getState()
        await (window as any).api.state.save({
          projects: state.projects,
          workspaces: state.workspaces,
          tabs: state.tabs,
          activeWorkspaceId: state.activeWorkspaceId,
          activeTabId: state.activeTabId,
          lastActiveTabByWorkspace: state.lastActiveTabByWorkspace,
          settings: state.settings,
          sidePanels: state.sidePanels,
        })
      })

      await app.close()

      ;({ app, window } = await launchApp(userDataPath))
      await window.waitForTimeout(1200)

      const persisted = await window.evaluate(async () => {
        return await (window as any).api.state.load()
      })
      expect(persisted.sidePanels.left.panelOrder).toEqual(['project', 'changes'])
      expect(persisted.sidePanels.left.activePanel).toBe('changes')
      expect(persisted.sidePanels.right.panelOrder).toEqual(['files', 'graph'])
    } finally {
      if (app) await app.close()
      cleanupTestRepo(repoPath)
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  test('keeps workspace and tab drag reorder working after custom docking', async () => {
    const repoPath = createTestRepo('panel-dock-regressions')
    const userDataPath = createUserDataPath('side-panel-regressions')
    const { app, window } = await launchApp(userDataPath)

    try {
      await setupProject(window, repoPath, [
        { name: 'alpha dock', branch: 'branch-alpha' },
        { name: 'beta dock', branch: 'branch-beta' },
      ])
      await window.waitForTimeout(1500)

      await dispatchDrag(window, '[data-panel-side="left"] [data-panel-type="project"]', '[data-panel-drop-target-side="right"]')
      await window.waitForTimeout(300)

      await dispatchDragByText(window, '[data-panel-side="right"]', 'beta dock', 'alpha dock')
      await window.waitForTimeout(300)

      const workspaceOrder = await window.evaluate(() => {
        const state = (window as any).__store.getState()
        const projectId = state.projects[0]?.id
        return state.workspaces.filter((ws: any) => ws.projectId === projectId).map((ws: any) => ws.name)
      })
      expect(workspaceOrder.slice(-2)).toEqual(['beta dock', 'alpha dock'])

      await window.evaluate(() => {
        const state = (window as any).__store.getState()
        const workspaceId = state.activeWorkspaceId
        const workspace = state.workspaces.find((entry: any) => entry.id === workspaceId)
        if (!workspace) throw new Error('Missing active workspace')
        state.addTab({
          id: crypto.randomUUID(),
          workspaceId,
          type: 'file',
          filePath: `${workspace.worktreePath}/README.md`,
        })
        state.addTab({
          id: crypto.randomUUID(),
          workspaceId,
          type: 'file',
          filePath: `${workspace.worktreePath}/src/index.ts`,
        })
      })
      await window.waitForTimeout(300)

      await dispatchDragByText(window, '[class*="tabBar"]', 'index.ts', 'README.md')
      await window.waitForTimeout(300)

      const tabOrder = await window.evaluate(() => {
        const state = (window as any).__store.getState()
        return state.tabs
          .filter((tab: any) => tab.workspaceId === state.activeWorkspaceId)
          .map((tab: any) => tab.type === 'file' ? tab.filePath.split('/').pop() : tab.title)
      })
      expect(tabOrder.slice(0, 2)).toEqual(['index.ts', 'README.md'])
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
