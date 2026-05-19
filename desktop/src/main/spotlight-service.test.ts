import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { SpotlightService } from './spotlight-service'

const execFileAsync = promisify(execFile)
let workRoot: string

async function runGit(cwd: string, ...args: string[]) {
  await execFileAsync('git', args, { cwd })
}

async function commit(cwd: string, message: string) {
  await execFileAsync(
    'git',
    ['-c', 'user.email=a@b', '-c', 'user.name=Tester', 'commit', '-q', '-m', message],
    { cwd },
  )
}

async function setup() {
  const remote = join(workRoot, 'remote.git')
  const seed = mkdtempSync(join(workRoot, 'seed-'))
  await runGit(seed, 'init', '-q', '-b', 'main')
  writeFileSync(join(seed, 'README.md'), 'seed\n')
  writeFileSync(join(seed, 'src.txt'), 'original\n')
  await runGit(seed, 'add', '.')
  await commit(seed, 'seed')
  await execFileAsync('git', ['clone', '--bare', '-q', seed, remote])

  const root = mkdtempSync(join(workRoot, 'root-'))
  await execFileAsync('git', ['clone', '-q', remote, root])
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'a@b'])
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Tester'])

  const worktree = join(workRoot, 'wt-feature')
  await execFileAsync('git', ['-C', root, 'worktree', 'add', '-b', 'feature', worktree])
  await execFileAsync('git', ['-C', worktree, 'config', 'user.email', 'a@b'])
  await execFileAsync('git', ['-C', worktree, 'config', 'user.name', 'Tester'])

  return { root, worktree }
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'constellagent-spotlight-svc-'))
})

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true })
  } catch {}
})

describe('SpotlightService integration', () => {
  it('enable() syncs worktree → root and disable() restores root', async () => {
    const { root, worktree } = await setup()
    // Untracked at root (mimics node_modules) — must survive.
    mkdirSync(join(root, 'cache_fake'), { recursive: true })
    writeFileSync(join(root, 'cache_fake', 'lib.txt'), 'cached\n')

    // Edit in worktree
    writeFileSync(join(worktree, 'src.txt'), 'spotlight edit\n')

    const svc = new SpotlightService()
    const status = await svc.enable({
      projectId: 'p1',
      workspaceId: 'ws-1',
      worktreePath: worktree,
      rootPath: root,
    })
    expect(['watching', 'error']).toContain(status.state)
    if (status.state === 'error') throw new Error(`Spotlight failed: ${status.message}`)

    // Root now reflects the worktree edit; untracked still present.
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('spotlight edit\n')
    expect(readFileSync(join(root, 'cache_fake', 'lib.txt'), 'utf8')).toBe('cached\n')

    await svc.disable('p1')

    // Root is back to its original commit state (no uncommitted root edits
    // were present, so restore just resets to HEAD).
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('original\n')
    // Untracked still present.
    expect(readFileSync(join(root, 'cache_fake', 'lib.txt'), 'utf8')).toBe('cached\n')
  })

  it('blocks when a rebase is in progress', async () => {
    const { root, worktree } = await setup()
    // Resolve the worktree's real gitdir (`worktree/.git` is a gitlink file
    // pointing to `<root>/.git/worktrees/<name>` for linked worktrees).
    const gitDir = (await execFileAsync('git', ['-C', worktree, 'rev-parse', '--git-dir'])).stdout.trim()
    const absGitDir = gitDir.startsWith('/') ? gitDir : join(worktree, gitDir)
    mkdirSync(join(absGitDir, 'rebase-merge'), { recursive: true })

    const svc = new SpotlightService()
    const status = await svc.enable({
      projectId: 'p2',
      workspaceId: 'ws-2',
      worktreePath: worktree,
      rootPath: root,
    })
    expect(status.state).toBe('blocked')
    await svc.disable('p2')
  })

  it('transferring spotlight to a second workspace in the same project releases the first', async () => {
    const { root, worktree } = await setup()
    const worktreeB = join(workRoot, 'wt-feature-b')
    await execFileAsync('git', ['-C', root, 'worktree', 'add', '-b', 'feature-b', worktreeB])
    writeFileSync(join(worktree, 'src.txt'), 'from A\n')
    writeFileSync(join(worktreeB, 'src.txt'), 'from B\n')

    const svc = new SpotlightService()
    await svc.enable({ projectId: 'p3', workspaceId: 'ws-A', worktreePath: worktree, rootPath: root })
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('from A\n')

    await svc.enable({ projectId: 'p3', workspaceId: 'ws-B', worktreePath: worktreeB, rootPath: root })
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('from B\n')

    await svc.disable('p3')
    // Root restored back to the original commit.
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('original\n')
  })

  it('preserves untracked root files across rapid resyncs', async () => {
    const { root, worktree } = await setup()
    writeFileSync(join(root, 'untracked.txt'), 'keep me\n')
    writeFileSync(join(worktree, 'src.txt'), 'v1\n')

    const svc = new SpotlightService()
    await svc.enable({ projectId: 'p4', workspaceId: 'ws-4', worktreePath: worktree, rootPath: root })
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('v1\n')
    expect(existsSync(join(root, 'untracked.txt'))).toBe(true)

    await svc.disable('p4')
    expect(existsSync(join(root, 'untracked.txt'))).toBe(true)
  })
})
