import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join, dirname } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, realpathSync } from 'fs'
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

/** Initial snapshot: several tracked files (root + nested). */
const INITIAL = {
  'alpha.txt': 'alpha-v0\n',
  'beta.txt': 'beta-v0\n',
  'nested/gamma.txt': 'gamma-v0\n',
  'nested/deep/delta.txt': 'delta-v0\n',
} as const

function createMultiFileRepo(name: string): string {
  const repoPath = join('/tmp', `test-restore-cp-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })

  for (const [rel, body] of Object.entries(INITIAL)) {
    const abs = join(repoPath, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }

  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "checkpoint baseline (multi-file)"', { cwd: repoPath })
  return repoPath
}

function cleanupTestRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) {
      rmSync(repoPath, { recursive: true, force: true })
    }
  } catch {
    // best effort
  }
}

test.describe('Context restore checkpoint', () => {
  test('restores multiple tracked files and removes untracked paths', async () => {
    const repoPath = createMultiFileRepo('multi')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const checkpointCommit = execSync('git rev-parse HEAD', { cwd: realRepo, encoding: 'utf8' }).trim()

      // Mutate every tracked file and add several untracked paths
      writeFileSync(join(realRepo, 'alpha.txt'), 'alpha-MODIFIED\n')
      writeFileSync(join(realRepo, 'beta.txt'), 'beta-MODIFIED\n')
      writeFileSync(join(realRepo, 'nested/gamma.txt'), 'gamma-MODIFIED\n')
      writeFileSync(join(realRepo, 'nested/deep/delta.txt'), 'delta-MODIFIED\n')
      writeFileSync(join(realRepo, 'untracked-root.txt'), 'should be deleted by clean\n')
      mkdirSync(join(realRepo, 'untracked-dir'), { recursive: true })
      writeFileSync(join(realRepo, 'untracked-dir/extra.txt'), 'gone\n')

      const result = await window.evaluate(
        async ({ repo, commit }: { repo: string; commit: string }) => {
          const api = (window as unknown as { api: { context: {
            restoreCheckpoint: (d: string, h: string, paths?: string[]) => Promise<{ success: boolean; verified: boolean }>
          } } }).api
          return api.context.restoreCheckpoint(repo, commit)
        },
        { repo: realRepo, commit: checkpointCommit },
      )

      expect(result.success).toBe(true)
      expect(result.verified).toBe(true)

      expect(readFileSync(join(realRepo, 'alpha.txt'), 'utf8')).toBe(INITIAL['alpha.txt'])
      expect(readFileSync(join(realRepo, 'beta.txt'), 'utf8')).toBe(INITIAL['beta.txt'])
      expect(readFileSync(join(realRepo, 'nested/gamma.txt'), 'utf8')).toBe(INITIAL['nested/gamma.txt'])
      expect(readFileSync(join(realRepo, 'nested/deep/delta.txt'), 'utf8')).toBe(INITIAL['nested/deep/delta.txt'])

      expect(existsSync(join(realRepo, 'untracked-root.txt'))).toBe(false)
      expect(existsSync(join(realRepo, 'untracked-dir/extra.txt'))).toBe(false)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('scoped restore reverts only the given path(s); leaves other edits and untracked files', async () => {
    const repoPath = createMultiFileRepo('scoped')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const checkpointCommit = execSync('git rev-parse HEAD', { cwd: realRepo, encoding: 'utf8' }).trim()

      writeFileSync(join(realRepo, 'alpha.txt'), 'alpha-MODIFIED\n')
      writeFileSync(join(realRepo, 'beta.txt'), 'beta-MODIFIED\n')
      writeFileSync(join(realRepo, 'nested/gamma.txt'), 'gamma-MODIFIED\n')
      writeFileSync(join(realRepo, 'only-untracked.txt'), 'keep me\n')

      const result = await window.evaluate(
        async ({ repo, commit }: { repo: string; commit: string }) => {
          const api = (window as unknown as { api: { context: {
            restoreCheckpoint: (d: string, h: string, paths?: string[]) => Promise<{ success: boolean; verified: boolean }>
          } } }).api
          return api.context.restoreCheckpoint(repo, commit, ['alpha.txt', 'nested/gamma.txt'])
        },
        { repo: realRepo, commit: checkpointCommit },
      )

      expect(result.success).toBe(true)
      expect(result.verified).toBe(true)

      expect(readFileSync(join(realRepo, 'alpha.txt'), 'utf8')).toBe(INITIAL['alpha.txt'])
      expect(readFileSync(join(realRepo, 'nested/gamma.txt'), 'utf8')).toBe(INITIAL['nested/gamma.txt'])
      expect(readFileSync(join(realRepo, 'beta.txt'), 'utf8')).toBe('beta-MODIFIED\n')
      expect(readFileSync(join(realRepo, 'nested/deep/delta.txt'), 'utf8')).toBe(INITIAL['nested/deep/delta.txt'])
      expect(readFileSync(join(realRepo, 'only-untracked.txt'), 'utf8')).toBe('keep me\n')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('scoped restore removes files that are absent from the checkpoint tree', async () => {
    const repoPath = createMultiFileRepo('absent')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      // Checkpoint is the initial commit — tree has alpha, beta, nested/gamma, nested/deep/delta.
      // note-new.txt and extra/stuff.txt do NOT exist in this tree.
      const checkpointCommit = execSync('git rev-parse HEAD', { cwd: realRepo, encoding: 'utf8' }).trim()

      // Create files that weren't in the checkpoint (untracked on disk)
      writeFileSync(join(realRepo, 'note-new.txt'), 'I should be deleted\n')
      mkdirSync(join(realRepo, 'extra'), { recursive: true })
      writeFileSync(join(realRepo, 'extra/stuff.txt'), 'Also gone\n')

      // Stage one of them so we test index cleanup too
      execSync('git add note-new.txt', { cwd: realRepo })

      // Also modify a tracked file to prove it stays untouched
      writeFileSync(join(realRepo, 'alpha.txt'), 'alpha-MODIFIED\n')

      const result = await window.evaluate(
        async ({ repo, commit }: { repo: string; commit: string }) => {
          const api = (window as unknown as { api: { context: {
            restoreCheckpoint: (d: string, h: string, paths?: string[]) => Promise<{ success: boolean; verified: boolean }>
          } } }).api
          return api.context.restoreCheckpoint(repo, commit, ['note-new.txt', 'extra/stuff.txt'])
        },
        { repo: realRepo, commit: checkpointCommit },
      )

      expect(result.success).toBe(true)
      expect(result.verified).toBe(true)

      // Files absent from tree should be deleted from disk
      expect(existsSync(join(realRepo, 'note-new.txt'))).toBe(false)
      expect(existsSync(join(realRepo, 'extra/stuff.txt'))).toBe(false)

      // Tracked file we did NOT include in restore paths stays modified
      expect(readFileSync(join(realRepo, 'alpha.txt'), 'utf8')).toBe('alpha-MODIFIED\n')

      // Other original files untouched
      expect(readFileSync(join(realRepo, 'beta.txt'), 'utf8')).toBe(INITIAL['beta.txt'])
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('multi-turn full restore preserves turn 1 files and removes turn 2 files', async () => {
    const repoPath = createMultiFileRepo('multiturn')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      // --- Turn 1: create 3 new files + modify a tracked file ---
      writeFileSync(join(realRepo, 'turn1-a.txt'), 'turn1-a-content\n')
      writeFileSync(join(realRepo, 'turn1-b.txt'), 'turn1-b-content\n')
      writeFileSync(join(realRepo, 'turn1-c.txt'), 'turn1-c-content\n')
      writeFileSync(join(realRepo, 'alpha.txt'), 'alpha-turn1-modified\n')

      // Checkpoint Turn 1 using temp index (mirrors save_checkpoint in shared.sh)
      const tmpIdx1 = join(realRepo, '.git', 'tmp-cp-1')
      const cpEnv1 = { ...process.env, GIT_INDEX_FILE: tmpIdx1 }
      execSync('git add -A', { cwd: realRepo, env: cpEnv1 })
      const turn1Tree = execSync('git write-tree', { cwd: realRepo, env: cpEnv1, encoding: 'utf8' }).trim()
      rmSync(tmpIdx1, { force: true })
      const turn1Commit = execSync(`git commit-tree -m "turn 1 checkpoint" ${turn1Tree}`, {
        cwd: realRepo, encoding: 'utf8',
      }).trim()
      execSync(`git update-ref refs/constellagent-cp/turn1 ${turn1Commit}`, { cwd: realRepo })

      // --- Turn 2: create 2 more files ---
      writeFileSync(join(realRepo, 'turn2-x.txt'), 'turn2-x-content\n')
      writeFileSync(join(realRepo, 'turn2-y.txt'), 'turn2-y-content\n')

      const tmpIdx2 = join(realRepo, '.git', 'tmp-cp-2')
      const cpEnv2 = { ...process.env, GIT_INDEX_FILE: tmpIdx2 }
      execSync('git add -A', { cwd: realRepo, env: cpEnv2 })
      const turn2Tree = execSync('git write-tree', { cwd: realRepo, env: cpEnv2, encoding: 'utf8' }).trim()
      rmSync(tmpIdx2, { force: true })
      execSync(`git commit-tree -m "turn 2 checkpoint" ${turn2Tree}`, { cwd: realRepo })

      // --- Full restore to Turn 1 checkpoint (no pathspecs) ---
      const result = await window.evaluate(
        async ({ repo, commit }: { repo: string; commit: string }) => {
          const api = (window as unknown as { api: { context: {
            restoreCheckpoint: (d: string, h: string, paths?: string[]) => Promise<{ success: boolean; verified: boolean }>
          } } }).api
          return api.context.restoreCheckpoint(repo, commit)
        },
        { repo: realRepo, commit: turn1Commit },
      )

      expect(result.success).toBe(true)
      expect(result.verified).toBe(true)

      // Turn 1 files present with correct content
      expect(readFileSync(join(realRepo, 'turn1-a.txt'), 'utf8')).toBe('turn1-a-content\n')
      expect(readFileSync(join(realRepo, 'turn1-b.txt'), 'utf8')).toBe('turn1-b-content\n')
      expect(readFileSync(join(realRepo, 'turn1-c.txt'), 'utf8')).toBe('turn1-c-content\n')

      // Modified tracked file restored to Turn 1 state
      expect(readFileSync(join(realRepo, 'alpha.txt'), 'utf8')).toBe('alpha-turn1-modified\n')

      // Turn 2 files removed
      expect(existsSync(join(realRepo, 'turn2-x.txt'))).toBe(false)
      expect(existsSync(join(realRepo, 'turn2-y.txt'))).toBe(false)

      // Original baseline files intact
      expect(readFileSync(join(realRepo, 'beta.txt'), 'utf8')).toBe(INITIAL['beta.txt'])
      expect(readFileSync(join(realRepo, 'nested/gamma.txt'), 'utf8')).toBe(INITIAL['nested/gamma.txt'])
      expect(readFileSync(join(realRepo, 'nested/deep/delta.txt'), 'utf8')).toBe(INITIAL['nested/deep/delta.txt'])
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('scoped restore handles a mix of in-tree and absent-from-tree paths', async () => {
    const repoPath = createMultiFileRepo('mixed')
    const realRepo = realpathSync(repoPath)
    const { app, window } = await launchApp()

    try {
      const checkpointCommit = execSync('git rev-parse HEAD', { cwd: realRepo, encoding: 'utf8' }).trim()

      // Modify a tracked file (in-tree) and create an untracked file (absent from tree)
      writeFileSync(join(realRepo, 'alpha.txt'), 'alpha-MODIFIED\n')
      writeFileSync(join(realRepo, 'brand-new.txt'), 'should vanish\n')

      const result = await window.evaluate(
        async ({ repo, commit }: { repo: string; commit: string }) => {
          const api = (window as unknown as { api: { context: {
            restoreCheckpoint: (d: string, h: string, paths?: string[]) => Promise<{ success: boolean; verified: boolean }>
          } } }).api
          return api.context.restoreCheckpoint(repo, commit, ['alpha.txt', 'brand-new.txt'])
        },
        { repo: realRepo, commit: checkpointCommit },
      )

      expect(result.success).toBe(true)
      expect(result.verified).toBe(true)

      // alpha.txt restored to original content
      expect(readFileSync(join(realRepo, 'alpha.txt'), 'utf8')).toBe(INITIAL['alpha.txt'])
      // brand-new.txt removed (not in checkpoint tree)
      expect(existsSync(join(realRepo, 'brand-new.txt'))).toBe(false)
      // Other files untouched
      expect(readFileSync(join(realRepo, 'beta.txt'), 'utf8')).toBe(INITIAL['beta.txt'])
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
