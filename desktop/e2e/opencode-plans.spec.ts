import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, utimesSync } from 'fs'
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

async function setupWorkspace(window: Page, repoPath: string) {
  return await window.evaluate(async (repo: string) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })

    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

    const worktreePath = await (window as any).api.git.createWorktree(repo, 'ws-opencode', 'branch-opencode', true)

    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId,
      name: 'ws-opencode',
      branch: 'branch-opencode',
      worktreePath,
      projectId,
    })

    return { worktreePath, wsId }
  }, repoPath)
}

test.describe('OpenCode plan discovery', () => {
  test('Cmd+Shift+M palette lists and filters OpenCode plans', async () => {
    const repoPath = createTestRepo('opencode-plan-palette')
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspace(window, repoPath)
      const opencodeDir = join(worktreePath, '.opencode', 'plans')
      const cursorDir = join(worktreePath, '.cursor', 'plans')
      mkdirSync(opencodeDir, { recursive: true })
      mkdirSync(cursorDir, { recursive: true })

      const opencodePlan = join(opencodeDir, 'opencode-plan.md')
      const cursorPlan = join(cursorDir, 'cursor-plan.md')
      writeFileSync(opencodePlan, '# OpenCode plan\n')
      writeFileSync(cursorPlan, '# Cursor plan\n')
      const now = new Date()
      utimesSync(opencodePlan, now, now)
      utimesSync(cursorPlan, new Date(now.getTime() - 60_000), new Date(now.getTime() - 60_000))

      await window.keyboard.press('Meta+Shift+M')
      await window.waitForTimeout(700)

      await expect(window.getByPlaceholder('Search plans with fff...')).toBeVisible()
      const planFilters = window.getByRole('group', { name: 'Plan filters' })
      await expect(planFilters.getByRole('button', { name: 'OpenCode', exact: true })).toBeVisible()
      await expect(window.getByText('opencode-plan.md', { exact: true })).toBeVisible()
      await expect(window.getByText('cursor-plan.md', { exact: true })).toBeVisible()

      await planFilters.getByRole('button', { name: 'OpenCode', exact: true }).click()
      await window.waitForTimeout(300)

      await expect(window.getByText('opencode-plan.md', { exact: true })).toBeVisible()
      await expect(window.getByText('cursor-plan.md', { exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('Plans button opens newest OpenCode plan', async () => {
    const repoPath = createTestRepo('opencode-plan-button')
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspace(window, repoPath)
      const opencodeDir = join(worktreePath, '.opencode', 'plans')
      const claudeDir = join(worktreePath, '.claude', 'plans')
      mkdirSync(opencodeDir, { recursive: true })
      mkdirSync(claudeDir, { recursive: true })

      const claudePlan = join(claudeDir, 'older-claude-plan.md')
      const opencodePlan = join(opencodeDir, 'newest-opencode-plan.md')
      writeFileSync(claudePlan, '# Older Claude plan\n')
      writeFileSync(opencodePlan, '# Newest OpenCode plan\n')
      const now = new Date()
      utimesSync(claudePlan, new Date(now.getTime() - 120_000), new Date(now.getTime() - 120_000))
      utimesSync(opencodePlan, now, now)

      await window.getByRole('button', { name: /Plans/ }).click()
      await window.waitForFunction((expectedPath) => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
        return tab?.type === 'markdownPreview' && tab?.filePath === expectedPath
      }, opencodePlan)

      const active = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        const tab = s.tabs.find((t: any) => t.id === s.activeTabId)
        return { type: tab?.type, filePath: tab?.filePath }
      })
      expect(active).toEqual({ type: 'markdownPreview', filePath: opencodePlan })
    } finally {
      await app.close()
    }
  })
})
