import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
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

function cleanupPath(targetPath: string): void {
  try {
    if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

function createRepoWithCredentialFixtures(name: string): { basePath: string; repoPath: string } {
  const basePath = join('/tmp', `test-worktree-creds-${name}-${Date.now()}`)
  const repoPath = join(basePath, 'repo')

  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  execSync('git add README.md', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })

  execSync('git checkout -b tracked-creds', { cwd: repoPath })
  mkdirSync(join(repoPath, 'apps', 'web'), { recursive: true })
  writeFileSync(join(repoPath, '.env'), 'TRACKED_SECRET=0\n')
  writeFileSync(join(repoPath, 'apps', 'web', '.env.local'), 'TRACKED_WEB_SECRET=0\n')
  writeFileSync(join(repoPath, '.npmrc'), 'tracked-registry=https://tracked.example\n')
  execSync('git add .env apps/web/.env.local .npmrc', { cwd: repoPath })
  execSync('git commit -m "add tracked credentials"', { cwd: repoPath })
  execSync('git checkout main', { cwd: repoPath })

  mkdirSync(join(repoPath, 'apps', 'web'), { recursive: true })
  mkdirSync(join(repoPath, '.claude'), { recursive: true })
  writeFileSync(join(repoPath, '.env'), 'ROOT_SECRET=1\n')
  writeFileSync(join(repoPath, 'apps', 'web', '.env.local'), 'WEB_SECRET=1\n')
  writeFileSync(join(repoPath, '.npmrc'), 'local-registry=https://local.example\n')
  writeFileSync(join(repoPath, 'credentials.json'), '{"token":"local"}\n')
  writeFileSync(join(repoPath, '.claude', 'settings.json'), '{"profile":"local"}\n')

  return { basePath, repoPath }
}

function createGraphiteRepoWithRemote(name: string): { basePath: string; repoPath: string } {
  const basePath = join('/tmp', `test-graphite-creds-${name}-${Date.now()}`)
  const repoPath = join(basePath, 'repo')
  const remotePath = join(basePath, 'remote.git')

  mkdirSync(repoPath, { recursive: true })
  execSync(`git init --bare "${remotePath}"`)

  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  execSync('git add README.md', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath })
  execSync('git -c core.hooksPath=/dev/null push -u origin main', { cwd: repoPath })

  execSync('git checkout -b feat-a', { cwd: repoPath })
  writeFileSync(join(repoPath, 'a.txt'), 'a\n')
  execSync('git add a.txt', { cwd: repoPath })
  execSync('git commit -m "feat a"', { cwd: repoPath })
  execSync('git -c core.hooksPath=/dev/null push -u origin feat-a', { cwd: repoPath })

  execSync('git checkout -b feat-b', { cwd: repoPath })
  writeFileSync(join(repoPath, 'b.txt'), 'b\n')
  execSync('git add b.txt', { cwd: repoPath })
  execSync('git commit -m "feat b"', { cwd: repoPath })
  execSync('git -c core.hooksPath=/dev/null push -u origin feat-b', { cwd: repoPath })

  execSync('git checkout main', { cwd: repoPath })
  mkdirSync(join(repoPath, '.claude'), { recursive: true })
  writeFileSync(join(repoPath, '.env'), 'GRAPHITE_SECRET=1\n')
  writeFileSync(join(repoPath, '.claude', 'settings.json'), '{"graphite":true}\n')

  return { basePath, repoPath }
}

test.describe('Worktree credential copy', () => {
  test('refreshes default env artifacts and preserves non-env tracked files', async () => {
    const { basePath, repoPath } = createRepoWithCredentialFixtures('defaults')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await window.evaluate(async (repo: string) => {
        return await (window as any).api.git.createWorktree(
          repo,
          'credential-copy',
          'tracked-creds',
          false,
        )
      }, repoPath)

      expect(readFileSync(join(worktreePath, '.env'), 'utf8')).toBe('ROOT_SECRET=1\n')
      expect(readFileSync(join(worktreePath, 'apps', 'web', '.env.local'), 'utf8')).toBe('WEB_SECRET=1\n')
      expect(readFileSync(join(worktreePath, 'credentials.json'), 'utf8')).toBe('{"token":"local"}\n')
      expect(readFileSync(join(worktreePath, '.claude', 'settings.json'), 'utf8')).toBe('{"profile":"local"}\n')
      expect(readFileSync(join(worktreePath, '.npmrc'), 'utf8')).toBe('tracked-registry=https://tracked.example\n')
    } finally {
      await app.close()
      cleanupPath(basePath)
    }
  })

  test('graphite clone stack uses the shared credential copier', async () => {
    const { basePath, repoPath } = createGraphiteRepoWithRemote('shared-helper')
    const { app, window } = await launchApp()

    try {
      const result = await window.evaluate(async (repo: string) => {
        return await (window as any).api.graphite.cloneStack(
          repo,
          'graphite-creds',
          [
            { name: 'feat-a', parent: 'main' },
            { name: 'feat-b', parent: 'feat-a' },
          ],
        )
      }, repoPath)

      expect(result.branch).toBe('feat-b')
      expect(readFileSync(join(result.worktreePath, '.env'), 'utf8')).toBe('GRAPHITE_SECRET=1\n')
      expect(readFileSync(join(result.worktreePath, '.claude', 'settings.json'), 'utf8')).toBe('{"graphite":true}\n')
    } finally {
      await app.close()
      cleanupPath(basePath)
    }
  })
})
