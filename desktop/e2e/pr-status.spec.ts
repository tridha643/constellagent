import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
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
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
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

test.describe('PR status (data + sidebar bar)', () => {
  test('getPrStatuses returns unavailable for local-only repo', async () => {
    const repoPath = createTestRepo('pr-local')
    const { app, window } = await launchApp()

    try {
      // Local test repo has no GitHub remote — should gracefully return unavailable
      const result = await window.evaluate(async (repo: string) => {
        return await (window as any).api.github.getPrStatuses(repo, ['main'])
      }, repoPath)

      expect(result.available).toBe(false)
      // Should be one of: gh_not_installed or not_github_repo
      expect(['gh_not_installed', 'not_github_repo']).toContain(result.error)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('store setPrStatuses populates prStatusMap including author + diff stats', async () => {
    const { app, window } = await launchApp()

    try {
      const result = await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.setPrStatuses('proj-1', {
          'feature-branch': {
            number: 42,
            state: 'open',
            title: 'Add feature',
            url: 'https://github.com/test/repo/pull/42',
            checkStatus: 'passing',
            hasPendingComments: false,
            pendingCommentCount: 0,
            isBlockedByCi: false,
            isApproved: false,
            isChangesRequested: false,
            updatedAt: new Date().toISOString(),
            authorLogin: 'octocat',
            additions: 120,
            deletions: 4,
          },
        })

        const updated = (window as any).__store.getState()
        const pr = updated.prStatusMap.get('proj-1:feature-branch')
        return { number: pr?.number ?? null, author: pr?.authorLogin ?? null, additions: pr?.additions ?? null, deletions: pr?.deletions ?? null }
      })

      expect(result.number).toBe(42)
      expect(result.author).toBe('octocat')
      expect(result.additions).toBe(120)
      expect(result.deletions).toBe(4)
    } finally {
      await app.close()
    }
  })

  test('linked workspace maps PR status under the local branch alias', async () => {
    const repoPath = createTestRepo('pr-linked-alias')
    const { app, window } = await launchApp()

    try {
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })

        const projectId = 'test-proj-linked-pr'
        const workspaceId = 'ws-linked-pr'
        store.addProject({ id: projectId, name: 'linked-pr-project', repoPath: repo })
        store.addWorkspace({
          id: workspaceId,
          name: 'pr-42',
          branch: 'pr/42-feature-from-fork',
          worktreePath: repo,
          projectId,
          linkedPullRequest: {
            number: 42,
            url: 'https://github.com/test/repo/pull/42',
            title: 'Fork PR',
            baseRefName: 'main',
            headRefName: 'feature/from-fork',
            headRepository: { owner: 'fork-owner', name: 'repo' },
            pushRemote: 'pr-42-head',
            pushRef: 'refs/heads/feature/from-fork',
          },
        })
      }, repoPath)

      await window.waitForTimeout(2500)

      const result = await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.setGhAvailability('test-proj-linked-pr', true)
        store.setPrStatuses('test-proj-linked-pr', {
          'pr/42-feature-from-fork': {
            number: 42,
            state: 'open',
            title: 'Fork PR',
            url: 'https://github.com/test/repo/pull/42',
            checkStatus: 'passing',
            hasPendingComments: false,
            pendingCommentCount: 0,
            isBlockedByCi: false,
            isApproved: false,
            isChangesRequested: false,
            updatedAt: new Date().toISOString(),
            authorLogin: 'fork-owner',
            additions: 5,
            deletions: 1,
          },
        })

        const after = (window as any).__store.getState()
        return {
          byAlias: after.prStatusMap.get('test-proj-linked-pr:pr/42-feature-from-fork')?.number ?? null,
          byHead: after.prStatusMap.get('test-proj-linked-pr:feature/from-fork')?.number ?? null,
          linkedNumber: after.workspaces.find((w: { id: string }) => w.id === 'ws-linked-pr')?.linkedPullRequest?.number ?? null,
        }
      })

      expect(result.byAlias).toBe(42)
      expect(result.byHead).toBeNull()
      expect(result.linkedNumber).toBe(42)

      // The bar flips to PR mode and shows the PR title.
      await window.waitForTimeout(400)
      const prFace = window.locator('[class*="wsFacePr"]')
      await expect(prFace.locator('[class*="wsTitle"]')).toContainText('Fork PR')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('store setGhAvailability tracks per-project availability', async () => {
    const { app, window } = await launchApp()

    try {
      const result = await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.setGhAvailability('proj-1', true)
        store.setGhAvailability('proj-2', false)

        const updated = (window as any).__store.getState()
        return {
          proj1: updated.ghAvailability.get('proj-1'),
          proj2: updated.ghAvailability.get('proj-2'),
        }
      })

      expect(result.proj1).toBe(true)
      expect(result.proj2).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('CI rollup chip reflects the PR check status', async () => {
    const repoPath = createTestRepo('pr-ci-chip')
    const { app, window } = await launchApp()

    try {
      await window.evaluate(async (repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        const projectId = 'test-proj-ci'
        store.addProject({ id: projectId, name: 'ci-project', repoPath: repo })
        store.addWorkspace({
          id: crypto.randomUUID(),
          name: 'main',
          branch: 'main',
          worktreePath: repo,
          projectId,
        })
      }, repoPath)

      await window.waitForTimeout(2500)

      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.setGhAvailability('test-proj-ci', true)
        store.setPrStatuses('test-proj-ci', {
          main: {
            number: 99,
            state: 'open',
            title: 'Failing PR',
            url: 'https://github.com/test/repo/pull/99',
            checkStatus: 'failing',
            hasPendingComments: false,
            pendingCommentCount: 0,
            isBlockedByCi: true,
            isApproved: false,
            isChangesRequested: false,
            updatedAt: new Date().toISOString(),
            authorLogin: 'octocat',
            additions: 1,
            deletions: 1,
          },
        })
      })

      await window.waitForTimeout(400)

      const prFace = window.locator('[class*="wsFacePr"]')
      await expect(prFace.locator('[class*="wsCiFail"]')).toBeVisible({ timeout: 3000 })
      await expect(prFace.locator('[class*="wsCiPass"]')).toHaveCount(0)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
