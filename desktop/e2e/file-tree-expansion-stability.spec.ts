import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
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
 * Mirrors the large-monorepo layout that surfaced the bug: a top-level
 * directory holding 1000+ child folders. Expanding it loads a huge child set,
 * and on a busy repo a watcher-driven `refreshLoaded` rebuilds the node tree
 * across several awaits while a concurrent git-status `rebuildSnapshot` reads
 * it. The old in-place rebuild let that read observe a half-built tree (parent
 * present, children gone), collapsing the just-opened folder for a frame, then
 * re-expanding when the refresh finished — the open/close flicker.
 */
function createHugeAppsRepo(name: string, appCount: number): string {
  const repoPath = join('/tmp', `test-huge-${name}-${Date.now()}`)
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

/** Count of `apps/` child rows currently rendered in pierre's shadow DOM. */
async function visibleAppChildCount(window: Page): Promise<number> {
  return await window.evaluate(() => {
    const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
    return host?.shadowRoot?.querySelectorAll('[data-item-path^="apps/app-"]').length ?? 0
  })
}

/**
 * Race the two refresh paths for ~4s: dispatch git:files-changed at 200ms
 * spacing (> the 120ms debounce, so refreshLoaded actually fires and is
 * in-flight) while firing dense direct git-status updates (each synchronously
 * triggers rebuildSnapshot). Sample the rendered child-row count throughout and
 * return the minimum. With the in-place rebuild, a status read landing
 * mid-refresh saw apps/ with no children and the count collapsed toward 0.
 */
async function minChildCountUnderChurn(window: Page, worktreePath: string): Promise<number> {
  return await window.evaluate(async (wt: string) => {
    let min = Number.POSITIVE_INFINITY
    const sample = () => {
      const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
      const n = host?.shadowRoot?.querySelectorAll('[data-item-path^="apps/app-"]').length ?? 0
      if (n < min) min = n
    }
    const store = () => (window as any).__store.getState()
    const start = performance.now()
    let i = 0
    let lastDispatch = 0
    while (performance.now() - start < 4000) {
      const now = performance.now()
      if (now - lastDispatch >= 200) {
        lastDispatch = now
        window.dispatchEvent(new CustomEvent('git:files-changed', { detail: { worktreePath: wt } }))
      }
      const m = new Map<string, string>()
      m.set(`apps/app-${String(i % 200).padStart(4, '0')}/config.ts`, i % 2 ? 'modified' : 'added')
      store().setGitFileStatuses(wt, m)
      sample()
      await new Promise((r) => setTimeout(r, 5))
      sample()
      i += 1
    }
    await new Promise((r) => setTimeout(r, 600))
    sample()
    return min === Number.POSITIVE_INFINITY ? -1 : min
  }, worktreePath)
}

test.describe('File tree expansion stability under churn', () => {
  test('expanded huge folder does not flicker when watcher refresh races status updates', async () => {
    const repoPath = createHugeAppsRepo('apps', 1200)
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'huge')
      await window.waitForTimeout(2500)

      const appsFolder = window.locator('[data-item-path="apps/"][data-item-type="folder"]').first()
      await expect(appsFolder).toBeVisible({ timeout: 8000 })
      await appsFolder.click()
      await expect.poll(() => visibleAppChildCount(window), { timeout: 8000 }).toBeGreaterThan(0)

      const baseline = await visibleAppChildCount(window)
      expect(baseline).toBeGreaterThan(10)

      const minSeen = await minChildCountUnderChurn(window, worktreePath)
      console.log('baseline child rows:', baseline, '| min during churn:', minSeen)

      // The expanded folder must never visibly empty out (allow virtualization
      // jitter, but not a collapse to near-zero).
      expect(minSeen, 'apps/ child rows collapsed mid-refresh (open/close flicker)').toBeGreaterThan(10)
      expect(await visibleAppChildCount(window)).toBeGreaterThan(10)
    } finally {
      await app.close()
      try { rmSync(repoPath, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  })

  test('opening a file inside the huge folder does not flicker its ancestors under churn', async () => {
    const repoPath = createHugeAppsRepo('apps-file', 1200)
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'hugefile')
      await window.waitForTimeout(2500)

      const appsFolder = window.locator('[data-item-path="apps/"][data-item-type="folder"]').first()
      await expect(appsFolder).toBeVisible({ timeout: 8000 })
      await appsFolder.click()
      await expect.poll(() => visibleAppChildCount(window), { timeout: 8000 }).toBeGreaterThan(0)

      // Expand a child folder, then open the file inside it (active file tab).
      // An active file under apps/ makes the reveal effect re-run on every
      // rebuild and deepens the loaded set (root -> apps/ -> apps/app-XXXX/),
      // widening the refreshLoaded window — the "opening files in those folders"
      // path the user reported. Same underlying race as the folder-expand case.
      const childFolder = window.locator('[data-item-path="apps/app-0000/"][data-item-type="folder"]').first()
      await childFolder.click()
      await window.waitForTimeout(300)
      await window.evaluate((wt: string) => {
        const store = (window as any).__store.getState()
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId: store.activeWorkspaceId,
          type: 'file',
          filePath: `${wt}/apps/app-0000/config.ts`,
        })
      }, worktreePath)
      await window.waitForTimeout(400)

      const baseline = await visibleAppChildCount(window)
      expect(baseline).toBeGreaterThan(10)

      const minSeen = await minChildCountUnderChurn(window, worktreePath)
      console.log('[file-open] baseline child rows:', baseline, '| min during churn:', minSeen)

      expect(minSeen, 'apps/ children collapsed mid-refresh with a file open (flicker)').toBeGreaterThan(10)
      expect(await visibleAppChildCount(window)).toBeGreaterThan(10)
    } finally {
      await app.close()
      try { rmSync(repoPath, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  })
})
