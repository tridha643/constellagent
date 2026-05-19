import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { GitService } from './git-service'

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

/**
 * Construct: a "remote" bare repo + two clones acting as the project repo root
 * and a workspace worktree. Spotlight syncs worktree → root.
 */
async function setupRootAndWorktree(): Promise<{ root: string; worktree: string }> {
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

  // Create a linked worktree on a feature branch — same shape as how
  // constellagent creates them.
  const worktree = join(workRoot, 'wt-feature')
  await execFileAsync('git', ['-C', root, 'worktree', 'add', '-b', 'feature', worktree])
  await execFileAsync('git', ['-C', worktree, 'config', 'user.email', 'a@b'])
  await execFileAsync('git', ['-C', worktree, 'config', 'user.name', 'Tester'])

  return { root, worktree }
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'constellagent-spotlight-test-'))
})

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('SpotlightService git helpers', () => {
  it('commitToSpotlightRef writes a commit to refs/spotlight/<wsId>', async () => {
    const { worktree } = await setupRootAndWorktree()
    writeFileSync(join(worktree, 'src.txt'), 'edited in worktree\n')
    const sha = await GitService.commitToSpotlightRef(worktree, 'ws-abc')
    expect(sha).toMatch(/^[0-9a-f]{40}$/)

    const refOut = (await execFileAsync('git', ['-C', worktree, 'rev-parse', 'refs/spotlight/ws-abc'])).stdout.trim()
    expect(refOut).toBe(sha)

    // The commit's tree must include the edited file.
    const showOut = (await execFileAsync('git', ['-C', worktree, 'show', `${sha}:src.txt`])).stdout
    expect(showOut).toBe('edited in worktree\n')
  })

  it('readTreeInto + checkout-index updates root to match the spotlight commit, leaves untracked files alone', async () => {
    const { root, worktree } = await setupRootAndWorktree()
    // Untracked at root — must survive the sync (this is the whole point of
    // Spotlight: build caches like node_modules stay put).
    const untrackedDir = join(root, 'node_modules_fake')
    mkdirSync(untrackedDir, { recursive: true })
    writeFileSync(join(untrackedDir, 'lib.txt'), 'I am a build cache\n')

    writeFileSync(join(worktree, 'src.txt'), 'edited in worktree\n')
    writeFileSync(join(worktree, 'new.txt'), 'fresh file\n')
    const sha = await GitService.commitToSpotlightRef(worktree, 'ws-abc')
    await GitService.readTreeInto(root, sha)

    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('edited in worktree\n')
    expect(readFileSync(join(root, 'new.txt'), 'utf8')).toBe('fresh file\n')
    // Untracked content preserved.
    expect(readFileSync(join(untrackedDir, 'lib.txt'), 'utf8')).toBe('I am a build cache\n')
  })

  it('snapshotForSpotlight + restoreSpotlightSnapshot round-trips HEAD and any uncommitted root edits', async () => {
    const { root, worktree } = await setupRootAndWorktree()
    const originalHead = (await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim()

    // Make uncommitted edits at root before Spotlight engages — they must be
    // preserved across enable/disable.
    writeFileSync(join(root, 'src.txt'), 'root-side uncommitted\n')

    const snapshot = await GitService.snapshotForSpotlight(root)
    expect(snapshot.head).toBe(originalHead)
    expect(snapshot.stashSha).toMatch(/^[0-9a-f]{40}$/)

    // After snapshot, root should be clean and HEAD-matching.
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('original\n')

    // Now simulate the spotlight overlay then restore.
    writeFileSync(join(worktree, 'src.txt'), 'worktree edit\n')
    const sha = await GitService.commitToSpotlightRef(worktree, 'ws-snap')
    await GitService.readTreeInto(root, sha)
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('worktree edit\n')

    await GitService.restoreSpotlightSnapshot(root, snapshot)
    const restoredHead = (await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim()
    expect(restoredHead).toBe(originalHead)
    // The pre-spotlight uncommitted edit should be back.
    expect(readFileSync(join(root, 'src.txt'), 'utf8')).toBe('root-side uncommitted\n')
  })

  it('hasRebaseOrMergeInProgress detects .git/MERGE_HEAD and rebase state', async () => {
    const { root } = await setupRootAndWorktree()
    expect(await GitService.hasRebaseOrMergeInProgress(root)).toBe(false)
    writeFileSync(join(root, '.git', 'MERGE_HEAD'), 'deadbeef\n')
    expect(await GitService.hasRebaseOrMergeInProgress(root)).toBe(true)
    rmSync(join(root, '.git', 'MERGE_HEAD'))
    mkdirSync(join(root, '.git', 'rebase-merge'), { recursive: true })
    expect(await GitService.hasRebaseOrMergeInProgress(root)).toBe(true)
  })

  it('deleteSpotlightRef removes the ref', async () => {
    const { worktree } = await setupRootAndWorktree()
    writeFileSync(join(worktree, 'src.txt'), 'x\n')
    await GitService.commitToSpotlightRef(worktree, 'ws-del')
    expect(existsSync(join(worktree, '.git'))).toBe(true)
    await GitService.deleteSpotlightRef(worktree, 'ws-del')
    const result = await execFileAsync('git', ['-C', worktree, 'rev-parse', '--verify', 'refs/spotlight/ws-del']).catch((e) => e)
    expect(result).toHaveProperty('code')
  })
})
