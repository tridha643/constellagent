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

function createRepoWithLargeContextFile(name: string): string {
  const repoPath = createTestRepo(name)
  const largeContent = Array.from({ length: 40 }, (_unused, i) => `line ${i + 1}`).join('\n') + '\n'
  writeFileSync(join(repoPath, 'README.md'), largeContent)
  execSync('git add README.md', { cwd: repoPath })
  execSync('git commit -m "add large context file"', { cwd: repoPath })
  return repoPath
}

// Lines per generated file. The review drawer auto-collapses large reviews,
// always expanding the first ~10 files; making each file this tall ensures those
// expanded files alone produce a tall, scrollable surface so the scroll /
// line-virtualization assertions are actually exercised (a 1-line diff per file
// leaves the surface shorter than the viewport, so it can never scroll).
const BULK_FILE_LINES = 60

function bulkFileContent(index: number, revision: number): string {
  return (
    Array.from(
      { length: BULK_FILE_LINES },
      (_, line) => `export const v${index}_${line} = ${line + revision};`,
    ).join('\n') + '\n'
  )
}

function seedTrackedFiles(repoPath: string, fileCount: number): void {
  const bulkDir = join(repoPath, 'bulk')
  mkdirSync(bulkDir, { recursive: true })
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(bulkDir, `file-${i}.ts`), bulkFileContent(i, 0))
  }
  execSync('git add bulk', { cwd: repoPath })
  execSync(`git commit -m "seed ${fileCount} tracked files"`, { cwd: repoPath })
}

function createRepoWithManyTrackedFiles(name: string, fileCount: number): string {
  const repoPath = createTestRepo(name)
  seedTrackedFiles(repoPath, fileCount)
  return repoPath
}

function mutateTrackedFiles(worktreePath: string, fileCount: number): void {
  // Rewrite every line so each file has a large multi-line diff (not a 1-liner).
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(worktreePath, 'bulk', `file-${i}.ts`), bulkFileContent(i, 1))
  }
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

async function setupWorkspaceWithoutAgent(window: Page, repoPath: string, suffix: string) {
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

    return { wsId, worktreePath }
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
      const handle = panel.getByTestId('hunk-review-resize-handle')
      await expect(panel).toBeVisible()
      await expect(handle).toBeVisible()

      // Drawer enters with translate-X + opacity; sequential Playwright boundingBox() snapshots can drift
      // apart mid-motion and send mouse.down() to the wrong coordinates (backdrop / chrome).
      await window.waitForTimeout(500)

      const geometry = await window.evaluate(() => {
        const card = document.querySelector('[data-testid="hunk-review-panel"]')
        const resize = document.querySelector('[data-testid="hunk-review-resize-handle"]')
        if (!(card instanceof HTMLElement) || !(resize instanceof HTMLElement)) return null
        const pr = card.getBoundingClientRect()
        const hr = resize.getBoundingClientRect()
        return {
          beforeWidth: pr.width,
          startX: hr.left + hr.width / 2,
          startY: hr.top + hr.height / 2,
        }
      })
      if (!geometry) throw new Error('Missing hunk review drawer geometry')

      await window.mouse.move(geometry.startX, geometry.startY)
      await window.mouse.down()
      await window.mouse.move(geometry.startX - 400, geometry.startY, { steps: 16 })
      await window.mouse.up()
      await window.waitForTimeout(250)

      const afterResizeBox = await panel.boundingBox()
      if (!afterResizeBox) throw new Error('Missing review panel bounds after resize')
      expect(afterResizeBox.width).toBeGreaterThan(geometry.beforeWidth + 150)

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

  test('review drawer opens without an agent terminal', async () => {
    const repoPath = createTestRepo('review-no-agent')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspaceWithoutAgent(window, realRepo, 'no-agent')
      writeFileSync(join(worktreePath, 'README.md'), '# Modified\nNo agent yet\n')

      await window.waitForTimeout(1200)
      await window.keyboard.press('Meta+Shift+R')

      await expect(window.getByTestId('hunk-review-panel')).toBeVisible()
      await expect(window.locator('text=Start an agent terminal before submitting selected comments.')).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('fast scrollbar drag on 220-file review keeps mounted sections bounded', async () => {
    test.setTimeout(90_000)
    const fileCount = 220
    const repoPath = createRepoWithManyTrackedFiles('review-many-files', fileCount)
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspaceWithAgent(window, realRepo, 'many-files')
      mutateTrackedFiles(worktreePath, fileCount)

      await window.waitForTimeout(1500)
      await window.keyboard.press('Meta+Shift+R')
      await expect(window.getByTestId('hunk-review-panel')).toBeVisible()

      const scrollArea = window.getByTestId('hunk-review-scroll-area')
      await expect(scrollArea).toBeVisible()
      // The real vertical scroller is CodeView's own root (overflow-y:auto) nested
      // inside the drawer's scroll-area, NOT the scroll-area div itself. Wait
      // deterministically until the expanded files have loaded + parsed into a
      // tall, scrollable surface there, instead of racing a fixed timeout.
      await window.waitForFunction(
        () => {
          const area = document.querySelector('[data-testid="hunk-review-scroll-area"]')
          if (!area) return false
          for (const el of area.querySelectorAll('*')) {
            if (!(el instanceof HTMLElement)) continue
            const oy = getComputedStyle(el).overflowY
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > 4000) return true
          }
          return false
        },
        { timeout: 30000 },
      )

      const scrollMetrics = await window.evaluate(async () => {
        const area = document.querySelector('[data-testid="hunk-review-scroll-area"]')
        if (!(area instanceof HTMLElement)) return null
        let root: HTMLElement | null = null
        for (const el of area.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement)) continue
          const oy = getComputedStyle(el).overflowY
          if (oy === 'auto' || oy === 'scroll') { root = el; break }
        }
        if (!root) return null

        const countSections = () => root.querySelectorAll('diffs-container').length
        const started = performance.now()
        const steps = 48
        let maxMounted = countSections()

        for (let step = 0; step < steps; step++) {
          const ratio = step / Math.max(1, steps - 1)
          root.scrollTop = Math.floor(ratio * Math.max(0, root.scrollHeight - root.clientHeight))
          root.dispatchEvent(new Event('scroll', { bubbles: true }))
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
          maxMounted = Math.max(maxMounted, countSections())
        }

        return {
          elapsedMs: performance.now() - started,
          maxMounted,
          scrollHeight: root.scrollHeight,
          fileSections: root.querySelectorAll('diffs-container').length,
        }
      })

      expect(scrollMetrics).not.toBeNull()
      if (!scrollMetrics) return
      expect(scrollMetrics.scrollHeight).toBeGreaterThan(4000)
      expect(scrollMetrics.maxMounted).toBeLessThan(40)
      expect(scrollMetrics.elapsedMs).toBeLessThan(5000)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('comment draft text survives virtualization scroll away and back', async () => {
    const repoPath = createTestRepo('review-draft-scroll')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspaceWithAgent(window, realRepo, 'draft-scroll')
      writeFileSync(join(worktreePath, 'README.md'), '# Modified\nLine two\nLine three\n')

      await window.waitForTimeout(1200)
      await window.keyboard.press('Meta+Shift+R')
      await expect(window.getByTestId('hunk-review-panel')).toBeVisible()

      const diffSection = window.locator('[data-testid="hunk-review-panel"] diffs-container').first()
      await expect(diffSection).toBeVisible()
      const filePath = await diffSection.locator('[data-file-path]').first().getAttribute('data-file-path')
      expect(filePath).toBeTruthy()

      await window.evaluate((path) => {
        window.dispatchEvent(new CustomEvent('diff:e2e-open-comment-composer', {
          detail: { filePath: path, lineNumber: 2, side: 'additions' },
        }))
      }, filePath!)

      // The composer is now a CodeMirror 6 contenteditable, not a textarea; the
      // testid host carries the doc text on `data-comment-body` for readback.
      const editor = window.getByTestId('diff-comment-composer-textarea')
      await expect(editor).toBeVisible()
      const draftText = 'Draft should survive virtualization scroll'
      await editor.fill(draftText)

      const afterScroll = await window.evaluate(async () => {
        const root = document.querySelector('[data-testid="hunk-review-scroll-area"]')
        if (!(root instanceof HTMLElement)) return null
        root.scrollTop = root.scrollHeight
        root.dispatchEvent(new Event('scroll', { bubbles: true }))
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
        root.scrollTop = 0
        root.dispatchEvent(new Event('scroll', { bubbles: true }))
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
        const el = document.querySelector('[data-testid="diff-comment-composer-textarea"]')
        return el instanceof HTMLElement ? (el.getAttribute('data-comment-body') ?? el.textContent) : null
      })

      expect(afterScroll).toBe(draftText)

      // The formatting toolbar's Bold button wraps the current selection as **…**.
      // Select the whole draft line within CodeMirror (End → Shift+Home; Mod+A
      // would trigger Pierre's select-all-lines + dirty-draft confirm dialog), then
      // fire the button's onClick directly — Playwright's hit-testing can't reach a
      // button nested in Pierre's virtualized annotation area, but it is light DOM.
      await editor.press('End')
      await editor.press('Shift+Home')
      await window.evaluate(() => {
        const btn = document.querySelector('[data-testid="composer-format-bold"]')
        if (btn instanceof HTMLElement) btn.click()
      })
      await expect
        .poll(async () =>
          window.evaluate(() => {
            const el = document.querySelector('[data-testid="diff-comment-composer-textarea"]')
            if (!(el instanceof HTMLElement)) return null
            return el.getAttribute('data-comment-body') ?? el.textContent
          }),
        )
        .toBe(`**${draftText}**`)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('review drawer honors full-context defaults and file toggles', async () => {
    const repoPath = createRepoWithLargeContextFile('review-expand')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspaceWithAgent(window, realRepo, 'expand')
      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.updateSettings({ diffShowFullContextByDefault: true })
      })
      const updatedContent = Array.from({ length: 40 }, (_unused, i) =>
        i === 19 ? 'line 20 changed' : `line ${i + 1}`,
      ).join('\n') + '\n'
      writeFileSync(join(worktreePath, 'README.md'), updatedContent)

      await window.waitForTimeout(1200)
      await window.keyboard.press('Meta+Shift+R')

      await expect(window.getByTestId('hunk-review-panel')).toBeVisible()
      // Single-file diff — scope the collapsed-context separator count to the panel.
      const reviewSection = window.getByTestId('hunk-review-panel')
      const showFullFileToggle = window.locator('[data-testid="show-full-file-toggle"]').first()
      await expect(showFullFileToggle).toBeVisible()
      await expect(showFullFileToggle).toHaveText('Changed only')
      await expect.poll(async () => reviewSection.locator('[data-unmodified-lines]').count()).toBe(0)
      await showFullFileToggle.click({ force: true })
      await expect(showFullFileToggle).toHaveText('Show full file')
      await expect.poll(async () => reviewSection.locator('[data-unmodified-lines]').count()).toBeGreaterThan(0)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
