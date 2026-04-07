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

async function setupWorkspaceWithAgent(window: Page, repoPath: string, suffix: string) {
  return await window.evaluate(async ({ repo, sfx }: { repo: string; sfx: string }) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [], settings: {} })

    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'review-test-repo', repoPath: repo })

    const worktreePath = await (window as any).api.git.createWorktree(repo, `review-${sfx}`, `review-${sfx}`, true)
    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId,
      name: `review-${sfx}`,
      branch: `review-${sfx}`,
      worktreePath,
      projectId,
    })

    const ptyId = await (window as any).api.pty.create(worktreePath)
    store.addTab({
      id: crypto.randomUUID(),
      workspaceId: wsId,
      type: 'terminal',
      title: 'Codex',
      ptyId,
      agentType: 'codex',
    })

    return { wsId, worktreePath, ptyId }
  }, { repo: repoPath, sfx: suffix })
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

  test('review drawer resizes and persists width across reopen', async () => {
    const repoPath = createTestRepo('review-drawer')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspaceWithAgent(window, realRepo, 'drawer')
      writeFileSync(join(worktreePath, 'README.md'), '# Modified\nDrag me\n')

      await window.waitForTimeout(1200)
      await window.keyboard.press('Meta+Shift+R')

      const panel = window.getByTestId('hunk-review-panel')
      const handle = window.getByTestId('hunk-review-resize-handle')
      await expect(panel).toBeVisible()
      await expect(handle).toBeVisible()

      const beforeBox = await panel.boundingBox()
      if (!beforeBox) throw new Error('Missing review panel bounds before resize')

      await handle.hover()
      await window.mouse.down()
      await window.mouse.move(beforeBox.x - 220, beforeBox.y + 24, { steps: 12 })
      await window.mouse.up()
      await window.waitForTimeout(250)

      const afterResizeBox = await panel.boundingBox()
      if (!afterResizeBox) throw new Error('Missing review panel bounds after resize')
      expect(afterResizeBox.width).toBeGreaterThan(beforeBox.width + 150)

      await window.keyboard.press('Escape')
      await expect(panel).toBeHidden()

      await window.keyboard.press('Meta+Shift+R')
      await expect(panel).toBeVisible()
      await window.waitForTimeout(200)

      const afterReopenBox = await panel.boundingBox()
      if (!afterReopenBox) throw new Error('Missing review panel bounds after reopen')
      expect(Math.abs(afterReopenBox.width - afterResizeBox.width)).toBeLessThanOrEqual(2)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
