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
  } catch { /* best effort */ }
}

test.describe('Review annotations IPC integration', () => {
  test('full comment lifecycle via IPC: add/list/remove/clear', async () => {
    const repoPath = createTestRepo('review-ipc')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      writeFileSync(join(realRepo, 'README.md'), '# Modified\nNew line\n')

      await window.evaluate(async (repo: string) => {
        await (window as any).api.review.commentAdd(repo, 'README.md', 1, 'Needs a better title', { force: true })
      }, realRepo)

      const comments = await window.evaluate(async (repo: string) => {
        return await (window as any).api.review.commentList(repo)
      }, realRepo)

      expect(Array.isArray(comments)).toBe(true)
      expect(comments.length).toBe(1)
      expect(comments[0].file_path).toBe('README.md')
      expect(comments[0].summary).toBe('Needs a better title')
      expect(typeof comments[0].id).toBe('string')
      expect(comments[0].id.length).toBeGreaterThan(0)
      expect(comments[0].side).toBe('new')
      expect(comments[0].line_start).toBe(1)
      expect(comments[0].line_end).toBe(1)

      const commentId = comments[0].id
      await window.evaluate(async (args: { repo: string; id: string }) => {
        await (window as any).api.review.commentRemove(args.repo, args.id)
      }, { repo: realRepo, id: commentId })

      const afterRemove = await window.evaluate(async (repo: string) => {
        return await (window as any).api.review.commentList(repo)
      }, realRepo)

      expect(afterRemove.length).toBe(0)

      await window.evaluate(async (repo: string) => {
        await (window as any).api.review.commentAdd(repo, 'README.md', 1, 'first', { force: true })
        await (window as any).api.review.commentAdd(repo, 'README.md', 2, 'second', { force: true })
      }, realRepo)

      const beforeClear = await window.evaluate(async (repo: string) => {
        return await (window as any).api.review.commentList(repo)
      }, realRepo)
      expect(beforeClear.length).toBe(2)

      await window.evaluate(async (repo: string) => {
        await (window as any).api.review.commentClear(repo)
      }, realRepo)

      const afterClear = await window.evaluate(async (repo: string) => {
        return await (window as any).api.review.commentList(repo)
      }, realRepo)
      expect(afterClear.length).toBe(0)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('commentResolve toggles resolved status', async () => {
    const repoPath = createTestRepo('review-resolve')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      writeFileSync(join(realRepo, 'README.md'), '# Changed\n')

      await window.evaluate(async (repo: string) => {
        await (window as any).api.review.commentAdd(repo, 'README.md', 1, 'Fix this', { force: true })
      }, realRepo)

      const comments = await window.evaluate(async (repo: string) => {
        return await (window as any).api.review.commentList(repo)
      }, realRepo)
      expect(comments[0].resolved).toBe(false)

      await window.evaluate(async (args: { repo: string; id: string }) => {
        await (window as any).api.review.commentResolve(args.repo, args.id, true)
      }, { repo: realRepo, id: comments[0].id })

      const afterResolve = await window.evaluate(async (repo: string) => {
        return await (window as any).api.review.commentList(repo)
      }, realRepo)
      expect(afterResolve[0].resolved).toBe(true)

      await window.evaluate(async (args: { repo: string; id: string }) => {
        await (window as any).api.review.commentResolve(args.repo, args.id, false)
      }, { repo: realRepo, id: comments[0].id })

      const afterUnresolve = await window.evaluate(async (repo: string) => {
        return await (window as any).api.review.commentList(repo)
      }, realRepo)
      expect(afterUnresolve[0].resolved).toBe(false)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('commentList returns ReviewComment fields', async () => {
    const repoPath = createTestRepo('review-fields')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      writeFileSync(join(realRepo, 'README.md'), '# Updated\nLine two\n')

      await window.evaluate(async (repo: string) => {
        await (window as any).api.review.commentAdd(repo, 'README.md', 1, 'Check this', { author: 'tester', force: true })
      }, realRepo)

      const comments = await window.evaluate(async (repo: string) => {
        return await (window as any).api.review.commentList(repo)
      }, realRepo)

      const c = comments[0]
      expect(c).toHaveProperty('id')
      expect(c).toHaveProperty('file_path')
      expect(c).toHaveProperty('summary')
      expect(c).toHaveProperty('side')
      expect(c).toHaveProperty('line_start')
      expect(c).toHaveProperty('line_end')
      expect(c).toHaveProperty('resolved')
      expect(c).toHaveProperty('created_at')
      expect(c.author).toBe('tester')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
