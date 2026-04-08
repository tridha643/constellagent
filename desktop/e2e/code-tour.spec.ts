import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, realpathSync } from 'fs'
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
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  mkdirSync(join(repoPath, '.constellagent'), { recursive: true })
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function cleanupTestRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true })
    const parentDir = resolve(repoPath, '..')
    const repoName = repoPath.split('/').pop()
    if (repoName) {
      for (const entry of readdirSync(parentDir)) {
        if (entry.startsWith(`${repoName}-ws-`)) {
          rmSync(join(parentDir, entry), { recursive: true, force: true })
        }
      }
    }
  } catch {
    // best effort
  }
}

async function setupWorkspaceWithAgent(window: Page, repoPath: string, suffix: string) {
  return await window.evaluate(async ({ repo, sfx }: { repo: string; sfx: string }) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [], settings: {} })

    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'code-tour-test-repo', repoPath: repo })

    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId,
      name: `tour-${sfx}`,
      branch: 'main',
      worktreePath: repo,
      projectId,
    })

    const ptyId = await (window as any).api.pty.create(repo)
    store.addTab({
      id: crypto.randomUUID(),
      workspaceId: wsId,
      type: 'terminal',
      title: 'Codex',
      ptyId,
      agentType: 'codex',
    })

    return { wsId, worktreePath: repo }
  }, { repo: repoPath, sfx: suffix })
}

test.describe('Code Tour happy path', () => {
  test('renders agent-authored annotations as navigable tour steps', async () => {
    const repoPath = createTestRepo('code-tour')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspaceWithAgent(window, realRepo, 'happy-path')

      writeFileSync(
        join(worktreePath, 'README.md'),
        '# Tour Test\n\nStep one changed\nStep two changed\n',
      )

      await window.evaluate(async (repo: string) => {
        await (window as any).api.review.commentAdd(
          repo,
          'README.md',
          1,
          'Explain the headline change',
          {
            author: 'opencode',
            rationale: 'This first step establishes the narrative and should be the default active step in Code Tour mode.',
            force: true,
          },
        )
        await (window as any).api.review.commentAdd(
          repo,
          'README.md',
          4,
          'Call out the second important change',
          {
            author: 'opencode',
            rationale: 'The second step should be reachable from the rail and from the Next button without losing diff context.',
            force: true,
          },
        )
      }, worktreePath)

      await window.waitForTimeout(1000)
      await window.keyboard.press('Meta+Shift+R')

      const panel = window.getByTestId('hunk-review-panel')
      await expect(panel).toBeVisible()

      await window.getByRole('button', { name: 'Code Tour' }).click()

      const codeTour = window.getByLabel('Code tour')
      await expect(codeTour).toBeVisible()
      await expect(codeTour.getByText('Walk the important changes')).toBeVisible()
      await expect(codeTour.getByText('Step 1 of 2')).toBeVisible()
      await expect(codeTour.getByText('Explain the headline change').first()).toBeVisible()
      await expect(codeTour.getByText('This first step establishes the narrative and should be the default active step in Code Tour mode.').first()).toBeVisible()

      await codeTour.getByRole('button', { name: 'Next', exact: true }).click()

      await expect(codeTour.getByText('Step 2 of 2')).toBeVisible()
      await expect(codeTour.getByText('Call out the second important change').first()).toBeVisible()
      await expect(codeTour.getByText('The second step should be reachable from the rail and from the Next button without losing diff context.').first()).toBeVisible()
      await expect(window.locator('[data-annotation-id]').filter({ hasText: 'Call out the second important change' })).toContainText('Code Tour')

      await codeTour.getByRole('button', { name: /Explain the headline change/ }).first().click()
      await expect(codeTour.getByText('Step 1 of 2')).toBeVisible()
      await expect(codeTour.getByText('This first step establishes the narrative and should be the default active step in Code Tour mode.').first()).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('loads annotations for git worktrees that use a shared common .git dir', async () => {
    const repoPath = createTestRepo('code-tour-worktree')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const worktreePath = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.createWorktree(
          repo,
          'tour-linked-worktree',
          'tour-linked-branch',
          true,
        )
      }, realRepo)

      writeFileSync(
        join(worktreePath, 'README.md'),
        '# Worktree Tour Test\n\nLinked worktree change\n',
      )

      await window.evaluate(async ({ repo, worktree }: { repo: string; worktree: string }) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [], settings: {} })

        const projectId = crypto.randomUUID()
        const workspaceId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'worktree-tour-repo', repoPath: repo })
        store.addWorkspace({
          id: workspaceId,
          name: 'tour-linked-worktree',
          branch: 'tour-linked-branch',
          worktreePath: worktree,
          projectId,
        })

        await (window as any).api.review.commentAdd(
          worktree,
          'README.md',
          1,
          'Worktree annotations use the shared review DB',
          {
            author: 'codex',
            rationale: 'Git worktrees store review annotations under the common .git directory, so the app has to resolve git-common-dir instead of assuming worktree/.git is a folder.',
            force: true,
          },
        )

        return await (window as any).api.review.commentList(worktree, 'README.md')
      }, { repo: realRepo, worktree: worktreePath }).then((rows: Array<{ summary: string; rationale: string | null }>) => {
        expect(rows.some((row) => row.summary === 'Worktree annotations use the shared review DB')).toBe(true)
        expect(rows.some((row) => row.rationale?.includes('git-common-dir'))).toBe(true)
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
