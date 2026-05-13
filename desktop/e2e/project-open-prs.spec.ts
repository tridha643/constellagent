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

function createLocalRepo(name: string): string {
  const repoPath = join('/tmp', `test-repo-project-prs-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function createRepoWithPullRef(name: string, prNumber: number): { basePath: string; repoPath: string; remotePath: string; prFile: string; headRefName: string } {
  const basePath = join('/tmp', `test-repo-project-pr-pull-${name}-${Date.now()}`)
  const repoPath = join(basePath, 'repo')
  const remotePath = join(basePath, 'remote.git')
  const prFile = 'PR_FILE.txt'
  const headRefName = 'feature/test-pr-ref'

  mkdirSync(basePath, { recursive: true })
  mkdirSync(repoPath, { recursive: true })
  execSync(`git init --bare "${remotePath}"`)

  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath })
  execSync('git -c core.hooksPath=/dev/null push -u origin main', { cwd: repoPath })

  execSync(`git checkout -b ${headRefName}`, { cwd: repoPath })
  writeFileSync(join(repoPath, prFile), 'from-pr\n')
  execSync(`git add ${prFile}`, { cwd: repoPath })
  execSync('git commit -m "pr commit"', { cwd: repoPath })
  execSync(`git -c core.hooksPath=/dev/null push origin HEAD:refs/heads/${headRefName}`, {
    cwd: repoPath,
  })
  execSync(`git -c core.hooksPath=/dev/null push origin HEAD:refs/pull/${prNumber}/head`, {
    cwd: repoPath,
  })
  execSync('git checkout main', { cwd: repoPath })

  return { basePath, repoPath, remotePath, prFile, headRefName }
}

function createForkStylePullRef(name: string, prNumber: number): {
  basePath: string
  repoPath: string
  forkRemotePath: string
  headRefName: string
} {
  const basePath = join('/tmp', `test-repo-project-pr-fork-${name}-${Date.now()}`)
  const repoPath = join(basePath, 'repo')
  const originPath = join(basePath, 'origin.git')
  const forkRemotePath = join(basePath, 'fork.git')
  const forkClonePath = join(basePath, 'fork-clone')
  const headRefName = 'feature/fork-pr'

  mkdirSync(basePath, { recursive: true })
  execSync(`git init --bare "${originPath}"`)
  execSync(`git init --bare "${forkRemotePath}"`)

  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  execSync(`git remote add origin "${originPath}"`, { cwd: repoPath })
  execSync('git -c core.hooksPath=/dev/null push -u origin main', { cwd: repoPath })
  execSync(`git --git-dir="${originPath}" symbolic-ref HEAD refs/heads/main`)

  execSync(`git clone "${originPath}" "${forkClonePath}"`)
  execSync('git config user.email "test@test.com"', { cwd: forkClonePath })
  execSync('git config user.name "Test"', { cwd: forkClonePath })
  execSync(`git remote add fork "${forkRemotePath}"`, { cwd: forkClonePath })
  execSync(`git checkout -b ${headRefName}`, { cwd: forkClonePath })
  writeFileSync(join(forkClonePath, 'FORK_FILE.txt'), 'from-fork\n')
  execSync('git add FORK_FILE.txt', { cwd: forkClonePath })
  execSync('git commit -m "fork pr commit"', { cwd: forkClonePath })
  execSync(`git -c core.hooksPath=/dev/null push fork HEAD:refs/heads/${headRefName}`, {
    cwd: forkClonePath,
  })
  execSync(`git -c core.hooksPath=/dev/null push origin HEAD:refs/pull/${prNumber}/head`, {
    cwd: forkClonePath,
  })

  return { basePath, repoPath, forkRemotePath, headRefName }
}

function cleanupPath(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

test.describe('Project open PR modal', () => {
  test('project PR button opens modal and shows unavailable state for local repo', async () => {
    const repoPath = createLocalRepo('popover-open')
    const { app, window } = await launchApp()

    try {
      await window.evaluate((repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        store.addProject({ id: 'proj-pr-popover', name: 'project-pr-popover', repoPath: repo })
      }, repoPath)

      const header = window.locator('[class*="projectHeader"]').first()
      await header.hover()

      const prButton = header.locator('button:has-text("PR")')
      await expect(prButton).toBeVisible()
      await prButton.click()

      const modal = window.locator('[data-project-pr-modal]')
      await expect(modal).toBeVisible()
      await expect(modal).toContainText(
        /(GitHub CLI is not installed|Origin remote is not a GitHub repo|GitHub CLI is not authenticated)/,
      )
    } finally {
      await app.close()
      cleanupPath(repoPath)
    }
  })

  test('project PR modal closes on escape and outside click', async () => {
    const repoPath = createLocalRepo('popover-close')
    const { app, window } = await launchApp()

    try {
      await window.evaluate((repo: string) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })
        store.addProject({ id: 'proj-pr-close', name: 'project-pr-close', repoPath: repo })
      }, repoPath)

      const header = window.locator('[class*="projectHeader"]').first()
      const prButton = header.locator('button:has-text("PR")')
      const modal = window.locator('[data-project-pr-modal]')

      await header.hover()
      await prButton.click()
      await expect(modal).toBeVisible()

      await window.keyboard.press('Escape')
      await expect(modal).not.toBeVisible()

      await header.hover()
      await prButton.click()
      await expect(modal).toBeVisible()
      await window.locator('[class*="projectPrModalOverlay"]').click({ position: { x: 8, y: 8 } })
      await expect(modal).not.toBeVisible()
    } finally {
      await app.close()
      cleanupPath(repoPath)
    }
  })

  test('git.createWorktreeFromPr checks out pull ref into a workspace', async () => {
    const prNumber = 42
    const { basePath, repoPath, prFile } = createRepoWithPullRef('create-worktree', prNumber)
    const { app, window } = await launchApp()

    try {
      const result = await window.evaluate(
        async ({ repo, pr }) => {
          return await (window as any).api.git.createWorktreeFromPr(
            repo,
            'pull-pr-locally',
            pr,
            'pr/42-feature-test',
          )
        },
        { repo: repoPath, pr: prNumber },
      )

      expect(result.worktreePath).toContain('-ws-pull-pr-locally')
      expect(result.branch).toBe('pr/42-feature-test')

      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: result.worktreePath,
      })
        .toString()
        .trim()
      expect(currentBranch).toBe(result.branch)
      expect(existsSync(join(result.worktreePath, prFile))).toBe(true)
    } finally {
      await app.close()
      cleanupPath(basePath)
    }
  })

  test('same-repo PR worktree pushes back to the PR head branch', async () => {
    const prNumber = 42
    const { basePath, repoPath, remotePath, headRefName } = createRepoWithPullRef('same-repo-push', prNumber)
    const { app, window } = await launchApp()

    try {
      const result = await window.evaluate(
        async ({ repo, pr, head }) => {
          return await (window as any).api.git.createWorktreeFromPr(
            repo,
            'same-repo-pr',
            pr,
            head,
            false,
            undefined,
            undefined,
            { headRefName: head, headRemoteName: 'origin' },
          )
        },
        { repo: repoPath, pr: prNumber, head: headRefName },
      )

      writeFileSync(join(result.worktreePath, 'SAME_REPO_PUSH.txt'), 'same repo update\n')
      execSync('git add SAME_REPO_PUSH.txt', { cwd: result.worktreePath })
      execSync('git commit -m "same repo pr update"', { cwd: result.worktreePath })

      const before = execSync(`git --git-dir="${remotePath}" rev-parse refs/heads/${headRefName}`).toString().trim()
      await window.evaluate(
        async ({ worktree, remote, head }) => {
          await (window as any).api.git.pushToPrHead(worktree, remote, head)
        },
        { worktree: result.worktreePath, remote: result.pushRemote, head: headRefName },
      )
      const after = execSync(`git --git-dir="${remotePath}" rev-parse refs/heads/${headRefName}`).toString().trim()

      expect(result.branch).toBe(headRefName)
      expect(result.pushRemote).toBe('origin')
      expect(result.pushRef).toBe(`refs/heads/${headRefName}`)
      expect(after).not.toBe(before)
    } finally {
      await app.close()
      cleanupPath(basePath)
    }
  })

  test('fork PR worktree pushes back to the fork head branch', async () => {
    const prNumber = 42
    const { basePath, repoPath, forkRemotePath, headRefName } = createForkStylePullRef('fork-push', prNumber)
    const { app, window } = await launchApp()

    try {
      const result = await window.evaluate(
        async ({ repo, pr, forkRemote, head }) => {
          return await (window as any).api.git.createWorktreeFromPr(
            repo,
            'fork-pr',
            pr,
            'pr/42-fork-pr',
            false,
            undefined,
            undefined,
            { headRefName: head, headRemoteName: 'pr-42-head', headRemoteUrl: forkRemote },
          )
        },
        { repo: repoPath, pr: prNumber, forkRemote: forkRemotePath, head: headRefName },
      )

      writeFileSync(join(result.worktreePath, 'FORK_PUSH.txt'), 'fork update\n')
      execSync('git add FORK_PUSH.txt', { cwd: result.worktreePath })
      execSync('git commit -m "fork pr update"', { cwd: result.worktreePath })

      const before = execSync(`git --git-dir="${forkRemotePath}" rev-parse refs/heads/${headRefName}`).toString().trim()
      await window.evaluate(
        async ({ worktree, remote, head }) => {
          await (window as any).api.git.pushToPrHead(worktree, remote, head)
        },
        { worktree: result.worktreePath, remote: result.pushRemote, head: headRefName },
      )
      const after = execSync(`git --git-dir="${forkRemotePath}" rev-parse refs/heads/${headRefName}`).toString().trim()

      expect(result.branch).toBe('pr/42-fork-pr')
      expect(result.pushRemote).toBe('pr-42-head')
      expect(result.pushRef).toBe(`refs/heads/${headRefName}`)
      expect(after).not.toBe(before)
    } finally {
      await app.close()
      cleanupPath(basePath)
    }
  })
})
