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
  } catch { /* best effort */ }
}

function isHunkAvailable(): boolean {
  try {
    execSync('hunk --version', { timeout: 5000, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

test.describe('Hunk review IPC integration', () => {
  test.skip(!isHunkAvailable(), 'hunk CLI not installed')

  test('hunk:available returns true when CLI is installed', async () => {
    const { app, window } = await launchApp()
    try {
      const available = await window.evaluate(async () => {
        return await (window as any).api.hunk.isAvailable()
      })
      expect(available).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('full comment lifecycle via IPC: start session, add/list/remove comments', async () => {
    const repoPath = createTestRepo('hunk-ipc')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      writeFileSync(join(realRepo, 'README.md'), '# Modified\nNew line\n')

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.startSession(repo)
      }, realRepo)

      await window.waitForTimeout(1000)

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.commentAdd(repo, 'README.md', 1, 'Needs a better title')
      }, realRepo)

      const comments = await window.evaluate(async (repo: string) => {
        return await (window as any).api.hunk.commentList(repo)
      }, realRepo)

      expect(Array.isArray(comments)).toBe(true)
      expect(comments.length).toBe(1)
      expect(comments[0].file).toBe('README.md')
      expect(comments[0].summary).toBe('Needs a better title')
      expect(typeof comments[0].id).toBe('string')
      expect(comments[0].id.length).toBeGreaterThan(0)
      expect(typeof comments[0].newLine).toBe('number')

      const commentId = comments[0].id
      await window.evaluate(async (args: { repo: string; id: string }) => {
        await (window as any).api.hunk.commentRemove(args.repo, args.id)
      }, { repo: realRepo, id: commentId })

      const afterRemove = await window.evaluate(async (repo: string) => {
        return await (window as any).api.hunk.commentList(repo)
      }, realRepo)

      expect(afterRemove.length).toBe(0)

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.commentAdd(repo, 'README.md', 1, 'first')
        await (window as any).api.hunk.commentAdd(repo, 'README.md', 1, 'second')
      }, realRepo)

      const beforeClear = await window.evaluate(async (repo: string) => {
        return await (window as any).api.hunk.commentList(repo)
      }, realRepo)
      expect(beforeClear.length).toBe(2)

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.commentClear(repo)
      }, realRepo)

      const afterClear = await window.evaluate(async (repo: string) => {
        return await (window as any).api.hunk.commentList(repo)
      }, realRepo)
      expect(afterClear.length).toBe(0)

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.stopSession(repo)
      }, realRepo)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('getContext returns session context for active session', async () => {
    const repoPath = createTestRepo('hunk-ctx')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      writeFileSync(join(realRepo, 'README.md'), '# Changed\n')

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.startSession(repo)
      }, realRepo)

      await window.waitForTimeout(1000)

      const ctx = await window.evaluate(async (repo: string) => {
        return await (window as any).api.hunk.getContext(repo)
      }, realRepo)

      expect(ctx).not.toBeNull()
      expect(typeof ctx.file).toBe('string')

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.stopSession(repo)
      }, realRepo)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('commentList returns mapped fields matching HunkComment interface', async () => {
    const repoPath = createTestRepo('hunk-fields')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      writeFileSync(join(realRepo, 'README.md'), '# Updated\nLine two\n')

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.startSession(repo)
      }, realRepo)
      await window.waitForTimeout(1000)

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.commentAdd(repo, 'README.md', 1, 'Check this', { author: 'tester' })
      }, realRepo)

      const comments = await window.evaluate(async (repo: string) => {
        return await (window as any).api.hunk.commentList(repo)
      }, realRepo)

      const c = comments[0]
      expect(c).toHaveProperty('id')
      expect(c).toHaveProperty('file')
      expect(c).toHaveProperty('summary')
      expect(c).not.toHaveProperty('commentId')
      expect(c).not.toHaveProperty('filePath')
      expect(c.newLine === undefined || typeof c.newLine === 'number').toBe(true)
      expect(c.oldLine === undefined || typeof c.oldLine === 'number').toBe(true)

      await window.evaluate(async (repo: string) => {
        await (window as any).api.hunk.stopSession(repo)
      }, realRepo)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
