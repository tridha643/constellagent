import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { GitService, RebaseConflictError } from './git-service'

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
 * Builds:
 *   - a bare "remote" repo
 *   - a "local" clone of it
 * with a shared initial commit on `main`.
 */
async function setupLocalRemote(): Promise<{ local: string; remote: string }> {
  const remote = join(workRoot, 'remote.git')
  const seed = mkdtempSync(join(workRoot, 'seed-'))
  await runGit(seed, 'init', '-q', '-b', 'main')
  writeFileSync(join(seed, 'README.md'), 'seed\n')
  await runGit(seed, 'add', '.')
  await commit(seed, 'seed')
  await execFileAsync('git', ['clone', '--bare', '-q', seed, remote])
  const local = mkdtempSync(join(workRoot, 'local-'))
  await execFileAsync('git', ['clone', '-q', remote, local])
  await execFileAsync(
    'git',
    ['-C', local, 'config', 'user.email', 'a@b'],
  )
  await execFileAsync(
    'git',
    ['-C', local, 'config', 'user.name', 'Tester'],
  )
  return { local, remote }
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'constellagent-rebase-test-'))
})

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('GitService.fetchAndRebase', () => {
  it('replays local commit on top of remote head when there is no conflict', async () => {
    const { local, remote } = await setupLocalRemote()

    // Another developer pushes to the remote by editing through a second clone.
    const other = mkdtempSync(join(workRoot, 'other-'))
    await execFileAsync('git', ['clone', '-q', remote, other])
    await execFileAsync('git', ['-C', other, 'config', 'user.email', 'b@b'])
    await execFileAsync('git', ['-C', other, 'config', 'user.name', 'Other'])
    writeFileSync(join(other, 'remote-only.txt'), 'from remote\n')
    await execFileAsync('git', ['-C', other, 'add', '.'])
    await commit(other, 'remote change')
    await execFileAsync('git', ['-C', other, 'push', '-q', 'origin', 'main'])

    // Local user commits a non-conflicting change.
    writeFileSync(join(local, 'local-only.txt'), 'from local\n')
    await execFileAsync('git', ['-C', local, 'add', '.'])
    await commit(local, 'local change')

    await GitService.fetchAndRebase(local, 'origin', 'main')

    // Rebase should be clean.
    expect(existsSync(join(local, '.git', 'rebase-merge'))).toBe(false)
    expect(existsSync(join(local, '.git', 'rebase-apply'))).toBe(false)

    // Both files should now be present locally.
    expect(existsSync(join(local, 'remote-only.txt'))).toBe(true)
    expect(existsSync(join(local, 'local-only.txt'))).toBe(true)

    // History should be linear: 3 commits, no merge commit.
    const { stdout } = await execFileAsync('git', ['-C', local, 'log', '--format=%P', '-n', '5'])
    const parentCounts = stdout
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => l.split(' ').length)
    expect(parentCounts.every((n) => n <= 1)).toBe(true)
  })

  it('throws RebaseConflictError and leaves the rebase mid-flight on conflict', async () => {
    const { local, remote } = await setupLocalRemote()

    // Other dev edits README.md and pushes.
    const other = mkdtempSync(join(workRoot, 'other-'))
    await execFileAsync('git', ['clone', '-q', remote, other])
    await execFileAsync('git', ['-C', other, 'config', 'user.email', 'b@b'])
    await execFileAsync('git', ['-C', other, 'config', 'user.name', 'Other'])
    writeFileSync(join(other, 'README.md'), 'remote version\n')
    await execFileAsync('git', ['-C', other, 'add', '.'])
    await commit(other, 'remote edit')
    await execFileAsync('git', ['-C', other, 'push', '-q', 'origin', 'main'])

    // Local user edits the same file differently.
    writeFileSync(join(local, 'README.md'), 'local version\n')
    await execFileAsync('git', ['-C', local, 'add', '.'])
    await commit(local, 'local edit')

    let caught: unknown = null
    try {
      await GitService.fetchAndRebase(local, 'origin', 'main')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(RebaseConflictError)
    const conflict = caught as RebaseConflictError
    expect(conflict.conflictedFiles).toContain('README.md')

    // Critical: do NOT auto-abort. The rebase must still be active so an agent (or the user) can resolve it.
    expect(existsSync(join(local, '.git', 'rebase-merge')) || existsSync(join(local, '.git', 'rebase-apply'))).toBe(true)

    // The conflict markers should be present in README.md.
    const readme = readFileSync(join(local, 'README.md'), 'utf-8')
    expect(readme.includes('<<<<<<<')).toBe(true)
  })
})

describe('GitService.listRebaseConflicts', () => {
  it('returns the set of UU files during a conflicted rebase', async () => {
    const { local, remote } = await setupLocalRemote()
    const other = mkdtempSync(join(workRoot, 'other-'))
    await execFileAsync('git', ['clone', '-q', remote, other])
    await execFileAsync('git', ['-C', other, 'config', 'user.email', 'b@b'])
    await execFileAsync('git', ['-C', other, 'config', 'user.name', 'Other'])
    writeFileSync(join(other, 'README.md'), 'remote\n')
    await execFileAsync('git', ['-C', other, 'add', '.'])
    await commit(other, 'remote edit')
    await execFileAsync('git', ['-C', other, 'push', '-q', 'origin', 'main'])

    writeFileSync(join(local, 'README.md'), 'local\n')
    await execFileAsync('git', ['-C', local, 'add', '.'])
    await commit(local, 'local edit')

    try {
      await GitService.fetchAndRebase(local, 'origin', 'main')
    } catch {
      // expected
    }

    const files = await GitService.listRebaseConflicts(local)
    expect(files).toContain('README.md')
  })
})

describe('GitService.isAheadOfRemote', () => {
  it('returns true after a local commit, false after the rebase replays it', async () => {
    const { local } = await setupLocalRemote()
    expect(await GitService.isAheadOfRemote(local, 'origin', 'main')).toBe(false)

    writeFileSync(join(local, 'f.txt'), 'x\n')
    await execFileAsync('git', ['-C', local, 'add', '.'])
    await commit(local, 'local')
    expect(await GitService.isAheadOfRemote(local, 'origin', 'main')).toBe(true)
  })
})
