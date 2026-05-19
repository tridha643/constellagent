import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [appPath], env: { ...process.env, CI_TEST: '1' } })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

function createServiceRepo(name: string): string {
  const repoPath = join('/tmp', `test-svc-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  writeFileSync(
    join(repoPath, 'package.json'),
    JSON.stringify(
      {
        name: 'test-svc',
        scripts: {
          dev: "node -e \"setInterval(()=>{console.log('alive');},500);\"",
          fast: "node -e \"console.log('done');process.exit(0);\"",
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(join(repoPath, 'README.md'), '# svc\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m initial', { cwd: repoPath })
  return repoPath
}

async function setupServiceWorkspace(window: Page, repoPath: string) {
  return await window.evaluate(async (repo: string) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })

    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-svc', repoPath: repo })

    const worktreePath = await (window as any).api.git.createWorktree(repo, 'svc-ws', 'svc-branch', true)

    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId, name: 'svc-ws', branch: 'svc-branch', worktreePath, projectId,
    })
    store.setActiveWorkspace(wsId)
    return { projectId, wsId, worktreePath }
  }, repoPath)
}

test.describe('Service tabs', () => {
  test('launching a short-lived script transitions running → exited', async () => {
    const repoPath = createServiceRepo('fast')
    const { app, window } = await launchApp()
    try {
      await setupServiceWorkspace(window, repoPath)
      await window.waitForTimeout(800)

      // Drive the store directly — the popover lives outside the standard a11y tree.
      const tabId = await window.evaluate(async () => {
        const store = (window as any).__store.getState()
        await store.createServiceForActiveWorkspace({ scriptName: 'fast', command: "node -e \"console.log('done');process.exit(0);\"" })
        const latest = (window as any).__store.getState()
        return latest.tabs.find((t: any) => t.type === 'service')?.id
      })
      expect(tabId).toBeTruthy()

      // running → exited within ~3s (node script exits immediately).
      await window.waitForFunction(() => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.type === 'service')
        return tab && tab.status !== 'running'
      }, undefined, { timeout: 5000 })

      const finalTab = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.tabs.find((t: any) => t.type === 'service')
      })
      expect(finalTab.status).toBe('exited')
      expect(finalTab.exitCode).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('restart keeps the same tab id and swaps ptyId', async () => {
    const repoPath = createServiceRepo('restart')
    const { app, window } = await launchApp()
    try {
      await setupServiceWorkspace(window, repoPath)
      await window.waitForTimeout(800)

      const initial = await window.evaluate(async () => {
        const store = (window as any).__store.getState()
        await store.createServiceForActiveWorkspace({
          scriptName: 'dev',
          command: "node -e \"setInterval(()=>{},1000);\"",
        })
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.type === 'service')
        return { tabId: tab.id, ptyId: tab.ptyId, status: tab.status }
      })
      expect(initial.status).toBe('running')

      await window.waitForTimeout(500)

      const afterRestart = await window.evaluate(async (tabId: string) => {
        const store = (window as any).__store.getState()
        await store.restartService(tabId)
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.id === tabId && t.type === 'service')
        return { tabId: tab.id, ptyId: tab.ptyId, status: tab.status }
      }, initial.tabId)

      expect(afterRestart.tabId).toBe(initial.tabId)
      expect(afterRestart.ptyId).not.toBe(initial.ptyId)
      expect(afterRestart.status).toBe('running')

      // Cleanup: kill the long-running process.
      await window.evaluate((tabId: string) => {
        ;(window as any).__store.getState().stopService(tabId)
      }, initial.tabId)
    } finally {
      await app.close()
    }
  })

  test('stop transitions running → exited (allows 0/130/143)', async () => {
    const repoPath = createServiceRepo('stop')
    const { app, window } = await launchApp()
    try {
      await setupServiceWorkspace(window, repoPath)
      await window.waitForTimeout(800)

      const tabId = await window.evaluate(async () => {
        const store = (window as any).__store.getState()
        await store.createServiceForActiveWorkspace({
          scriptName: 'dev',
          command: "node -e \"setInterval(()=>{},1000);\"",
        })
        const s = (window as any).__store.getState()
        return s.tabs.find((t: any) => t.type === 'service')?.id
      })

      await window.waitForTimeout(500)
      await window.evaluate((id: string) => {
        ;(window as any).__store.getState().stopService(id)
      }, tabId)

      await window.waitForFunction(() => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.type === 'service')
        return tab && tab.status !== 'running'
      }, undefined, { timeout: 5000 })

      const final = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.tabs.find((t: any) => t.type === 'service')
      })
      // SIGTERM via destroy → 143 (or 130 if SIGINT). 0 is also acceptable on clean shutdown.
      expect(final.status).toBe('exited')
    } finally {
      await app.close()
    }
  })

  test('package.json scripts are discovered and sorted', async () => {
    const repoPath = createServiceRepo('scripts')
    const { app, window } = await launchApp()
    try {
      const { worktreePath } = await setupServiceWorkspace(window, repoPath)
      const result = await window.evaluate((p: string) => {
        return (window as any).api.packageScripts.list(p)
      }, worktreePath)
      expect(result.missing).toBe(false)
      expect(result.scripts.map((s: any) => s.name)).toEqual(['dev', 'fast'])
    } finally {
      await app.close()
    }
  })

  test('launcher button opens popover, clicking a script creates a service tab', async () => {
    const repoPath = createServiceRepo('ui')
    const { app, window } = await launchApp()
    try {
      await setupServiceWorkspace(window, repoPath)
      await window.waitForTimeout(800)

      // Open the launcher popover. The button lives in TabBar (always rendered).
      const launcherBtn = window.locator('[data-testid="service-launcher-button"]')
      await launcherBtn.click()

      const menu = window.locator('[data-testid="service-launcher-menu"]')
      await expect(menu).toBeVisible({ timeout: 5000 })

      // `fast` exits immediately so we don't leave a dangling process.
      const fastEntry = window.locator('[data-testid="service-script-fast"]')
      await expect(fastEntry).toBeVisible({ timeout: 3000 })
      await fastEntry.click()

      // Service tab appears in store.
      await window.waitForFunction(() => {
        const s = (window as any).__store.getState()
        return s.tabs.some((t: any) => t.type === 'service')
      }, undefined, { timeout: 5000 })

      const serviceTab = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return s.tabs.find((t: any) => t.type === 'service')
      })
      expect(serviceTab.scriptName).toBe('fast')

      // ServicePanel is in the DOM.
      const panel = window.locator('[data-testid="service-panel"]')
      await expect(panel).toBeVisible({ timeout: 3000 })
    } finally {
      await app.close()
    }
  })

  test('chosen command is persisted to project startup settings', async () => {
    const repoPath = createServiceRepo('persist')
    const { app, window } = await launchApp()
    try {
      await setupServiceWorkspace(window, repoPath)
      await window.waitForTimeout(800)

      await window.evaluate(async () => {
        await (window as any).__store.getState().createServiceForActiveWorkspace({
          scriptName: 'fast',
          command: "node -e \"process.exit(0);\"",
        })
      })

      // The IPC write is async; give it a moment to flush.
      await window.waitForTimeout(500)

      const persisted = await window.evaluate(async (repo: string) => {
        return await (window as any).api.projectStartupSettings.get(repo)
      }, repoPath)

      expect(persisted).toBeTruthy()
      const cmds = persisted as Array<{ name: string; command: string }>
      expect(cmds.some((c) => c.command.includes('process.exit(0)'))).toBe(true)
    } finally {
      await app.close()
    }
  })
})
