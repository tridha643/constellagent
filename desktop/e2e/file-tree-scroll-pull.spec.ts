import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs'
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

/**
 * Large-monorepo layout (the shape the user hit): a top-level `apps/`
 * holding 1000+ child folders, each a directory with a file inside. Scrolling
 * far down then expanding a folder there must NOT yank the viewport back to
 * wherever the active file tab lives.
 */
function createHugeAppsRepo(name: string, appCount: number): string {
  const repoPath = join('/tmp', `test-scrollpull-${name}-${Date.now()}`)
  mkdirSync(join(repoPath, 'apps'), { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  for (let i = 0; i < appCount; i += 1) {
    const dir = join(repoPath, 'apps', `app-${String(i).padStart(4, '0')}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.ts'), `export const id = ${i}\n`)
  }
  writeFileSync(join(repoPath, 'README.md'), '# huge\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git -c user.email=t@t.t -c user.name=t commit -m init', { cwd: repoPath })
  return repoPath
}

async function setupWorkspace(window: Page, repoPath: string, suffix: string): Promise<string> {
  return await window.evaluate(async ({ repo, sfx }: { repo: string; sfx: string }) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })
    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'huge-repo', repoPath: repo })
    const worktreePath = await (window as any).api.git.createWorktree(repo, `ws-${sfx}`, `branch-${sfx}`, true)
    const wsId = crypto.randomUUID()
    store.addWorkspace({ id: wsId, name: `ws-${sfx}`, branch: `branch-${sfx}`, worktreePath, projectId })
    return worktreePath
  }, { repo: repoPath, sfx: suffix })
}

async function treeScrollTop(window: Page): Promise<number> {
  return await window.evaluate(() => {
    const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
    const scroller = host?.shadowRoot?.querySelector('[data-file-tree-virtualized-scroll]') as HTMLElement | null
    return scroller?.scrollTop ?? -1
  })
}

async function setTreeScrollTop(window: Page, top: number): Promise<void> {
  await window.evaluate((t: number) => {
    const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
    const scroller = host?.shadowRoot?.querySelector('[data-file-tree-virtualized-scroll]') as HTMLElement | null
    if (!scroller) return
    scroller.scrollTop = t
    scroller.dispatchEvent(new Event('scroll'))
  }, top)
}

test.describe('File tree scroll stability', () => {
  test('expanding a far-down folder does not pull scroll back to the active file', async () => {
    const repoPath = createHugeAppsRepo('apps', 1200)
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'scroll')
      await window.waitForTimeout(2500)

      // Expand apps/ to materialize the 1200 child folders.
      const appsFolder = window.locator('[data-item-path="apps/"][data-item-type="folder"]').first()
      await expect(appsFolder).toBeVisible({ timeout: 8000 })
      await appsFolder.click()
      await expect
        .poll(async () =>
          window.evaluate(() => {
            const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
            return host?.shadowRoot?.querySelectorAll('[data-item-path^="apps/app-"]').length ?? 0
          }),
        { timeout: 8000 })
        .toBeGreaterThan(0)

      // Make an EARLY file the active tab. The reveal effect expands its ancestor
      // and scrolls to it near the top — this is the "old clicked folder".
      const realRoot = realpathSync(worktreePath)
      await window.evaluate((root: string) => {
        const store = (window as any).__store.getState()
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId: store.activeWorkspaceId,
          type: 'file',
          filePath: `${root}/apps/app-0000/config.ts`,
        })
      }, realRoot)
      await window.waitForTimeout(800)

      // The user scrolls far DOWN to a folder they want to open.
      await setTreeScrollTop(window, 12000)
      await window.waitForTimeout(300)
      const scrollBefore = await treeScrollTop(window)
      expect(scrollBefore, 'precondition: scrolled far down').toBeGreaterThan(6000)

      // Find a folder that is now rendered in the viewport and expand it.
      const targetPath = await window.evaluate(() => {
        const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
        const rows = Array.from(
          host?.shadowRoot?.querySelectorAll('[data-item-path^="apps/app-"][data-item-type="folder"]') ?? [],
        ) as HTMLElement[]
        // Pick one roughly in the middle of the rendered window so it's clickable.
        const mid = rows[Math.floor(rows.length / 2)]
        return mid?.dataset.itemPath ?? null
      })
      expect(targetPath, 'a far-down folder should be rendered to click').toBeTruthy()

      const targetFolder = window.locator(`[data-item-path="${targetPath}"][data-item-type="folder"]`).first()
      await targetFolder.click()

      // Let the lazy load + resetPaths + any reveal re-fire settle.
      await window.waitForTimeout(700)

      const scrollAfter = await treeScrollTop(window)
      console.log('[scroll-pull] before:', scrollBefore, '| after expanding', targetPath, ':', scrollAfter)

      // The viewport must stay where the user was. A jump back toward the top
      // (the active file's location) is the "pulled to the old clicked folder" bug.
      expect(
        scrollAfter,
        'expanding a folder yanked the viewport back toward the active file (scroll pull)',
      ).toBeGreaterThan(scrollBefore - 1500)
    } finally {
      await app.close()
      try { rmSync(repoPath, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  })

  // Guards the reason the reveal effect used to depend on snapshot.paths: opening
  // a deeply-nested file whose ancestor isn't loaded yet must still expand its
  // ancestors and scroll to it. The fix replaces the snapshot re-trigger with a
  // bounded per-frame retry, so this must keep working without the spurious
  // re-reveals. (Pierre only scroll-into-views when the tree owns DOM focus, so
  // we click a row first — matching the real "navigate the tree, then open a
  // file" flow the user described.)
  test('opening a deeply-nested, unloaded file scrolls to and reveals it', async () => {
    const repoPath = createHugeAppsRepo('deep', 1200)
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'deep')
      await window.waitForTimeout(2500)

      // Expand apps/ — this also gives the tree DOM focus.
      const appsFolder = window.locator('[data-item-path="apps/"][data-item-type="folder"]').first()
      await expect(appsFolder).toBeVisible({ timeout: 8000 })
      await appsFolder.click()
      await expect
        .poll(async () =>
          window.evaluate(() => {
            const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
            return host?.shadowRoot?.querySelectorAll('[data-item-path^="apps/app-"]').length ?? 0
          }),
        { timeout: 8000 })
        .toBeGreaterThan(0)

      // Open a file far down whose parent folder (apps/app-1100/) is NOT yet
      // loaded — the reveal must lazy-load it, then focus + scroll to the file.
      const realRoot = realpathSync(worktreePath)
      const targetRel = 'apps/app-1100/config.ts'
      await window.evaluate((root: string) => {
        const store = (window as any).__store.getState()
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId: store.activeWorkspaceId,
          type: 'file',
          filePath: `${root}/apps/app-1100/config.ts`,
        })
      }, realRoot)

      // The reveal must materialize the row and bring it into view.
      await expect
        .poll(async () =>
          window.evaluate((rel: string) => {
            const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
            return !!host?.shadowRoot?.querySelector(`[data-item-path="${rel}"]`)
          }, targetRel),
        { timeout: 8000 })
        .toBe(true)

      // app-1100 is far down a 1200-folder list, so revealing it must scroll.
      const scrollTop = await treeScrollTop(window)
      console.log('[deep-reveal] scrollTop after opening', targetRel, ':', scrollTop)
      expect(scrollTop, 'deeply-nested file was not scrolled into view').toBeGreaterThan(1000)
    } finally {
      await app.close()
      try { rmSync(repoPath, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  })
})
