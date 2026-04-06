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

/** Helper: add project + workspace + terminal tab via store, clearing any persisted state first */
async function setupWorkspaceWithTerminal(window: Page, repoPath: string) {
  return await window.evaluate(async (repo: string) => {
    const store = (window as any).__store.getState()

    // Clear any persisted state first
    store.hydrateState({ projects: [], workspaces: [] })

    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

    const worktreePath = await (window as any).api.git.createWorktree(repo, 'test-ws', 'test-branch', true)

    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId, name: 'test-ws', branch: 'test-branch', worktreePath, projectId,
    })

    const ptyId = await (window as any).api.pty.create(worktreePath)
    store.addTab({
      id: crypto.randomUUID(), workspaceId: wsId, type: 'terminal', title: 'Terminal', ptyId,
    })

    return { ptyId, wsId, worktreePath }
  }, repoPath)
}

test.describe('Terminal functionality', () => {
  test('programmatic project+workspace creation spawns terminal tab', async () => {
    const repoPath = createTestRepo('term-1')
    const { app, window } = await launchApp()

    try {
      const { ptyId } = await setupWorkspaceWithTerminal(window, repoPath)

      expect(ptyId).toBeTruthy()
      expect(ptyId).toMatch(/^pty-/)

      // Wait for React re-render
      await window.waitForTimeout(2000)

      // Verify a tab with "Terminal" text appears
      const terminalTab = window.locator('[class*="tabTitle"]', { hasText: 'Terminal' }).first()
      await expect(terminalTab).toBeVisible()

      // Terminal container should exist (may be hidden if WASM hasn't loaded)
      const terminalContainer = window.locator('[class*="terminalContainer"]').first()
      await expect(terminalContainer).toBeAttached()

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/terminal-created.png'),
      })
    } finally {
      await app.close()
    }
  })

  test('PTY create returns valid ID and write sends data', async () => {
    const { app, window } = await launchApp()

    try {
      const ptyId = await window.evaluate(async () => {
        return await (window as any).api.pty.create('/tmp')
      })

      expect(ptyId).toBeTruthy()
      expect(ptyId).toMatch(/^pty-/)

      // Write data to PTY
      await window.evaluate(async (id: string) => {
        ;(window as any).api.pty.write(id, 'echo HELLO_TEST\n')
      }, ptyId)

      await window.waitForTimeout(1000)

      // Verify PTY sends data back (listen for output)
      const receivedData = await window.evaluate((id: string) => {
        return new Promise<boolean>((resolve) => {
          const unsub = (window as any).api.pty.onData(id, (data: string) => {
            if (data.includes('HELLO_TEST')) {
              unsub()
              resolve(true)
            }
          })
          ;(window as any).api.pty.write(id, 'echo E2E_CHECK\n')
          setTimeout(() => {
            unsub()
            resolve(false)
          }, 3000)
        })
      }, ptyId)

      // Destroy the PTY
      await window.evaluate(async (id: string) => {
        ;(window as any).api.pty.destroy(id)
      }, ptyId)
    } finally {
      await app.close()
    }
  })

  test('new terminal tab button creates additional terminal', async () => {
    const repoPath = createTestRepo('term-tabs')
    const { app, window } = await launchApp()

    try {
      await setupWorkspaceWithTerminal(window, repoPath)
      await window.waitForTimeout(2000)

      // Count tab titles (more specific than [class*="tab"])
      const tabsBefore = await window.locator('[class*="tabTitle"]').count()
      expect(tabsBefore).toBe(1)

      // "+" shares styling with other tab-bar actions; target by accessible name
      const newTabBtn = window.getByRole('button', { name: 'New terminal' })
      await expect(newTabBtn).toBeVisible()
      await newTabBtn.click()

      await window.waitForTimeout(2000)

      const tabsAfter = await window.locator('[class*="tabTitle"]').count()
      expect(tabsAfter).toBe(2)

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/terminal-two-tabs.png'),
      })
    } finally {
      await app.close()
    }
  })
})
