import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve, join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

const appPath = resolve(__dirname, '../out/main/index.js')

function createUserDataPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), `constellagent-${name}-`)), 'user-data')
}

async function launchApp(userDataPath?: string): Promise<{ app: ElectronApplication; window: Page }> {
  const env = { ...process.env, CI_TEST: '1' } as Record<string, string>
  if (userDataPath) env.CONSTELLAGENT_USER_DATA_PATH = userDataPath
  const app = await electron.launch({ args: [appPath], env })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.map((a) => JSON.stringify(a)).join(' ')}`, { cwd }).toString()
}

function setupRepoWithWorktree(): { root: string; worktree: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'spotlight-e2e-'))
  const root = join(base, 'root')
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 'a@b')
  git(root, 'config', 'user.name', 'Tester')
  writeFileSync(join(root, 'README.md'), 'seed\n')
  writeFileSync(join(root, 'src.txt'), 'original\n')
  git(root, 'add', '.')
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed')
  const worktree = join(base, 'wt-feature')
  git(root, 'worktree', 'add', '-b', 'feature', worktree)
  git(worktree, 'config', 'user.email', 'a@b')
  git(worktree, 'config', 'user.name', 'Tester')
  return { root, worktree, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

test.describe('spotlight testing', () => {
  test('enable/disable syncs root from worktree and restores on disable', async () => {
    const repo = setupRepoWithWorktree()
    const userDataPath = createUserDataPath('spotlight-roundtrip')

    // Make a worktree edit before app start
    writeFileSync(join(repo.worktree, 'src.txt'), 'spotlighted\n')

    const { app, window } = await launchApp(userDataPath)
    try {
      // Seed store with a project + workspace pointing at our temp repo.
      // Drive entirely through the exposed window.__store so we don't need
      // to script the sidebar UI.
      const projectId = 'proj-test'
      const workspaceId = 'ws-test'
      await window.evaluate(({ projectId, workspaceId, root, worktree }) => {
        const store = (window as any).__store.getState()
        store.hydrateState({
          projects: [{ id: projectId, name: 'test', repoPath: root, startupCommands: [] }],
          workspaces: [{ id: workspaceId, projectId, name: 'feature', branch: 'feature', worktreePath: worktree }],
        })
      }, { projectId, workspaceId, root: repo.root, worktree: repo.worktree })

      // Enable via the renderer-exposed API (same IPC surface the context menu uses).
      const enabled = await window.evaluate(async ({ projectId, workspaceId, root, worktree }) => {
        return await (window as any).api.spotlight.enable({
          projectId, workspaceId, worktreePath: worktree, rootPath: root,
        })
      }, { projectId, workspaceId, root: repo.root, worktree: repo.worktree })

      expect(['watching', 'syncing']).toContain(enabled.state)
      expect(readFileSync(join(repo.root, 'src.txt'), 'utf8')).toBe('spotlighted\n')

      // Wait for the status broadcast to settle in the store.
      await expect.poll(async () => {
        return await window.evaluate((projectId) => {
          const s = (window as any).__store.getState()
          return s.spotlightStatusByProject.get(projectId)?.state ?? null
        }, projectId)
      }, { timeout: 5000 }).toBe('watching')

      await window.evaluate(async (projectId) => {
        await (window as any).api.spotlight.disable(projectId)
      }, projectId)

      expect(readFileSync(join(repo.root, 'src.txt'), 'utf8')).toBe('original\n')
    } finally {
      await app.close()
      repo.cleanup()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
