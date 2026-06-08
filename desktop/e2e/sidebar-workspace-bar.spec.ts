import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const { ELECTRON_RENDERER_URL: _ignoredRendererUrl, ...env } = process.env
  const app = await electron.launch({ args: [appPath], env: { ...env, CI_TEST: '1' } })
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
  execSync('git -c user.email=a@b.test -c user.name=Tester commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function cleanupTestRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

test.describe('Sidebar workspace bar (rudu port)', () => {
  test('PR mode renders author, PR title, and PR stats', async () => {
    const repoPath = createTestRepo('wsbar-pr')
    const { app, window } = await launchApp()

    try {
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = 'wsbar-pr-proj'
        store.addProject({ id: projectId, name: 'wsbar-pr-project', repoPath: repo })
        store.addWorkspace({
          id: 'wsbar-pr-ws',
          name: 'feat-bar',
          branch: 'feat/bar',
          worktreePath: repo,
          projectId,
        })
      }, repoPath)

      // Let the pollers settle so injected state isn't overwritten.
      await window.waitForTimeout(2500)

      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.setGhAvailability('wsbar-pr-proj', true)
        store.setPrStatuses('wsbar-pr-proj', {
          'feat/bar': {
            number: 7,
            state: 'open',
            title: 'docs(agents): document email-to-PR automation',
            url: 'https://github.com/test/repo/pull/7',
            checkStatus: 'passing',
            hasPendingComments: false,
            pendingCommentCount: 0,
            isBlockedByCi: false,
            isApproved: false,
            isChangesRequested: false,
            updatedAt: new Date().toISOString(),
            authorLogin: 'octocat',
            additions: 21,
            deletions: 3,
          },
        })
      })

      await window.waitForTimeout(400)

      // Faces wrapper flips to PR mode.
      await expect(window.locator('[class*="wsFaces"][data-mode="pr"]')).toBeVisible({ timeout: 3000 })

      const prFace = window.locator('[class*="wsFacePr"]')
      await expect(prFace.locator('[class*="wsAuthorLogin"]')).toContainText('octocat')
      await expect(prFace.locator('[class*="wsTitle"]')).toContainText('email-to-PR automation')

      const prStats = prFace.locator('[class*="wsStats"]')
      await expect(prStats).toContainText('+21')
      await expect(prStats).toContainText('-3')

      await expect(prFace.locator('[class*="wsCiPass"]')).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('local mode renders commit subject and local stats', async () => {
    const repoPath = createTestRepo('wsbar-local')
    const { app, window } = await launchApp()

    try {
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = 'wsbar-local-proj'
        store.addProject({ id: projectId, name: 'wsbar-local-project', repoPath: repo })
        store.addWorkspace({
          id: 'wsbar-local-ws',
          name: 'fix-focus',
          branch: 'fix/quick-open-focus',
          worktreePath: repo,
          projectId,
        })
      }, repoPath)

      await window.waitForTimeout(2500)

      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.setWorkspaceBarStats('wsbar-local-ws', {
          subject: 'wip: focus trap on quick-open reopen',
          additions: 34,
          deletions: 12,
          headSha: '1111111111111111111111111111111111111111',
        })
      })

      await window.waitForTimeout(400)

      await expect(window.locator('[class*="wsFaces"][data-mode="local"]')).toBeVisible({ timeout: 3000 })

      const localFace = window.locator('[class*="wsFaceLocal"]')
      await expect(localFace.locator('[class*="wsTitle"]')).toContainText('focus trap on quick-open reopen')

      const localStats = localFace.locator('[class*="wsStats"]')
      await expect(localStats).toContainText('+34')
      await expect(localStats).toContainText('-12')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('non-GitHub project falls back to the project name in the header', async () => {
    const repoPath = createTestRepo('wsbar-fallback')
    const { app, window } = await launchApp()

    try {
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = 'wsbar-fallback-proj'
        store.addProject({ id: projectId, name: 'internal-tooling', repoPath: repo })
        store.addWorkspace({
          id: 'wsbar-fallback-ws',
          name: 'main',
          branch: 'main',
          worktreePath: repo,
          projectId,
        })
        // Explicitly resolved-but-not-GitHub.
        store.setProjectRepoInfo(projectId, null)
      }, repoPath)

      await window.waitForTimeout(500)

      const repoName = window.locator('[class*="repoName"]', { hasText: 'internal-tooling' })
      await expect(repoName).toBeVisible({ timeout: 3000 })
      // Name fallback: no owner/ slug rendered.
      await expect(repoName.locator('[class*="repoOwner"]')).toHaveCount(0)
      // The generic fallback glyph is shown instead of an avatar image.
      await expect(window.locator('[class*="glyphFallback"]').first()).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
