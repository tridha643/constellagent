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

function createGraphiteRepo(name: string): string {
  const repoPath = join('/tmp', `test-graphite-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test\n')
  execSync('git add . && git commit -m "init"', { cwd: repoPath })
  execSync('git checkout -b feat-a', { cwd: repoPath })
  writeFileSync(join(repoPath, 'a.txt'), 'a\n')
  execSync('git add . && git commit -m "feat a"', { cwd: repoPath })
  execSync('git checkout -b feat-b', { cwd: repoPath })
  writeFileSync(join(repoPath, 'b.txt'), 'b\n')
  execSync('git add . && git commit -m "feat b"', { cwd: repoPath })
  return repoPath
}

function writeGraphiteSqliteDb(repoPath: string, entries: { name: string; parent: string }[]): void {
  const dbPath = join(repoPath, '.git', '.graphite_metadata.db')
  execSync(`sqlite3 "${dbPath}" "CREATE TABLE IF NOT EXISTS branch_metadata (branch_name TEXT PRIMARY KEY, parent_branch_name TEXT);"`)
  for (const e of entries) {
    execSync(`sqlite3 "${dbPath}" "INSERT OR REPLACE INTO branch_metadata (branch_name, parent_branch_name) VALUES ('${e.name}', '${e.parent}');"`)
  }
}

function writeGraphiteRefMetadata(repoPath: string, branch: string, parentBranch: string): void {
  const json = JSON.stringify({ parentBranchName: parentBranch })
  const objectId = execSync(`echo '${json}' | git hash-object -w --stdin`, { cwd: repoPath }).toString().trim()
  execSync(`git update-ref refs/branch-metadata/${branch} ${objectId}`, { cwd: repoPath })
}

function cleanupRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true })
  } catch { /* best effort */ }
}

test.describe('Graphite stack metadata parsing', () => {
  test('reads stack from SQLite metadata DB (current CLI)', async () => {
    const repoPath = createGraphiteRepo('sqlite')
    writeGraphiteSqliteDb(repoPath, [
      { name: 'feat-a', parent: 'main' },
      { name: 'feat-b', parent: 'feat-a' },
    ])

    const { app, window } = await launchApp()
    try {
      const stack = await window.evaluate(async (args: { repo: string; wt: string }) => {
        return await (window as any).api.graphite.getStack(args.repo, args.wt)
      }, { repo: repoPath, wt: repoPath })

      expect(stack).not.toBeNull()
      expect(stack.branches).toHaveLength(3)
      expect(stack.branches[0].name).toBe('main')
      expect(stack.branches[1].name).toBe('feat-a')
      expect(stack.branches[2].name).toBe('feat-b')
      expect(stack.currentBranch).toBe('feat-b')
    } finally {
      await app.close()
      cleanupRepo(repoPath)
    }
  })

  test('reads stack from refs/branch-metadata (older CLI)', async () => {
    const repoPath = createGraphiteRepo('refs')
    writeGraphiteRefMetadata(repoPath, 'feat-a', 'main')
    writeGraphiteRefMetadata(repoPath, 'feat-b', 'feat-a')

    const { app, window } = await launchApp()
    try {
      const stack = await window.evaluate(async (args: { repo: string; wt: string }) => {
        return await (window as any).api.graphite.getStack(args.repo, args.wt)
      }, { repo: repoPath, wt: repoPath })

      expect(stack).not.toBeNull()
      expect(stack.branches).toHaveLength(3)
      expect(stack.branches[0].name).toBe('main')
      expect(stack.branches[1].name).toBe('feat-a')
      expect(stack.branches[2].name).toBe('feat-b')
      expect(stack.currentBranch).toBe('feat-b')
    } finally {
      await app.close()
      cleanupRepo(repoPath)
    }
  })

  test('reads stack from git config (cloneStack fallback)', async () => {
    const repoPath = createGraphiteRepo('config')
    execSync(`git config graphite.branch.feat-a.parent main`, { cwd: repoPath })
    execSync(`git config graphite.branch.feat-b.parent feat-a`, { cwd: repoPath })

    const { app, window } = await launchApp()
    try {
      const stack = await window.evaluate(async (args: { repo: string; wt: string }) => {
        return await (window as any).api.graphite.getStack(args.repo, args.wt)
      }, { repo: repoPath, wt: repoPath })

      expect(stack).not.toBeNull()
      expect(stack.branches).toHaveLength(3)
      expect(stack.branches[0].name).toBe('main')
      expect(stack.branches[1].name).toBe('feat-a')
      expect(stack.branches[2].name).toBe('feat-b')
      expect(stack.currentBranch).toBe('feat-b')
    } finally {
      await app.close()
      cleanupRepo(repoPath)
    }
  })


  test('lists Graphite trunks and source branches for new worktree creation', async () => {
    const repoPath = createGraphiteRepo('create-options')
    writeGraphiteSqliteDb(repoPath, [
      { name: 'feat-a', parent: 'main' },
      { name: 'feat-b', parent: 'feat-a' },
      { name: 'hotfix-a', parent: 'release-v10' },
    ])

    const { app, window } = await launchApp()
    try {
      const options = await window.evaluate(async (repo: string) => {
        return await (window as any).api.graphite.getCreateOptions(repo)
      }, repoPath)

      expect(options).not.toBeNull()
      expect(options.trunks).toEqual(['main', 'release-v10'])
      expect(options.branches.map((branch: { name: string }) => branch.name)).toEqual(['feat-a', 'feat-b', 'hotfix-a'])
      expect(options.branches.find((branch: { name: string }) => branch.name === 'feat-b')).toMatchObject({
        parent: 'feat-a',
        trunk: 'main',
      })
    } finally {
      await app.close()
      cleanupRepo(repoPath)
    }
  })

  test('writes branch parent metadata for newly created Graphite children', async () => {
    const repoPath = createGraphiteRepo('set-parent')
    writeGraphiteSqliteDb(repoPath, [
      { name: 'feat-a', parent: 'main' },
      { name: 'feat-b', parent: 'feat-a' },
    ])

    const { app, window } = await launchApp()
    try {
      await window.evaluate(async (repo: string) => {
        await (window as any).api.graphite.setBranchParent(repo, 'feat-c', 'feat-b')
      }, repoPath)

      const options = await window.evaluate(async (repo: string) => {
        return await (window as any).api.graphite.getCreateOptions(repo)
      }, repoPath)

      expect(options).not.toBeNull()
      expect(options.branches.find((branch: { name: string }) => branch.name === 'feat-c')).toMatchObject({
        parent: 'feat-b',
        trunk: 'main',
      })
    } finally {
      await app.close()
      cleanupRepo(repoPath)
    }
  })

  test('returns null when no graphite metadata exists', async () => {
    const repoPath = createGraphiteRepo('empty')

    const { app, window } = await launchApp()
    try {
      const stack = await window.evaluate(async (args: { repo: string; wt: string }) => {
        return await (window as any).api.graphite.getStack(args.repo, args.wt)
      }, { repo: repoPath, wt: repoPath })

      expect(stack).toBeNull()
    } finally {
      await app.close()
      cleanupRepo(repoPath)
    }
  })
})
