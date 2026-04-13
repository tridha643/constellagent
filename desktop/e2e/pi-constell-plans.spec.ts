import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'

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

test.describe('PI Constell plan discovery', () => {
  test('Cmd+Shift+M palette lists and filters PI Constell plans', async () => {
    const repoPath = createTestRepo('pi-constell-plan-palette')
    const { app, window } = await launchApp()
    const piConstellDir = join(homedir(), '.pi-constell', 'plans')
    const piConstellPlan = join(piConstellDir, `pi-constell-plan-${Date.now()}.md`)

    try {
      const { worktreePath } = await setupWorkspace(window, repoPath)
      const cursorDir = join(worktreePath, '.cursor', 'plans')
      mkdirSync(piConstellDir, { recursive: true })
      mkdirSync(cursorDir, { recursive: true })

      const cursorPlan = join(cursorDir, 'cursor-plan.md')
      writeFileSync(piConstellPlan, '# PI Constell plan\n')
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
    const piConstellDir = join(homedir(), '.pi-constell', 'plans')
    const piConstellPlan = join(piConstellDir, `newest-pi-constell-plan-${Date.now()}.md`)

    try {
      const { worktreePath } = await setupWorkspace(window, repoPath)
      const claudeDir = join(worktreePath, '.claude', 'plans')
      mkdirSync(piConstellDir, { recursive: true })
      mkdirSync(claudeDir, { recursive: true })

      const claudePlan = join(claudeDir, 'older-claude-plan.md')
      writeFileSync(claudePlan, '# Older Claude plan\n')
      writeFileSync(piConstellPlan, '# Newest PI Constell plan\n')
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
    } finally {
      rmSync(piConstellPlan, { force: true })
      await app.close()
    }
  })
})
