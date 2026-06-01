import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { GitService, parseWorktreeListPorcelain } from './git-service'

const execFileAsync = promisify(execFile)

let workRoot: string

async function runGit(cwd: string, ...args: string[]) {
  await execFileAsync('git', args, { cwd })
}

async function makeRepoWithWorktrees(): Promise<{ repoPath: string; wtA: string; wtB: string }> {
  const repoPath = mkdtempSync(join(workRoot, 'repo-'))
  await runGit(repoPath, 'init', '-q', '-b', 'main')
  await runGit(repoPath, '-c', 'user.email=a@b', '-c', 'user.name=Tester', 'commit', '-q', '--allow-empty', '-m', 'first')
  const wtA = join(workRoot, 'wt-a')
  const wtB = join(workRoot, 'wt-b')
  await runGit(repoPath, 'worktree', 'add', '-q', '-b', 'feature/a', wtA)
  await runGit(repoPath, 'worktree', 'add', '-q', '-b', 'feature/b', wtB)
  return { repoPath, wtA, wtB }
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'constellagent-branches-test-'))
})

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

describe('GitService.getCurrentBranches', () => {
  it('resolves the main checkout and all worktrees in one call', async () => {
    const { repoPath, wtA, wtB } = await makeRepoWithWorktrees()

    const branches = await GitService.getCurrentBranches(repoPath, [repoPath, wtA, wtB])

    expect(branches[repoPath]).toBe('main')
    expect(branches[wtA]).toBe('feature/a')
    expect(branches[wtB]).toBe('feature/b')
  })

  it('matches getCurrentBranch for every path, including detached HEAD', async () => {
    const { repoPath, wtA, wtB } = await makeRepoWithWorktrees()
    await runGit(wtB, 'checkout', '-q', '--detach')

    const paths = [repoPath, wtA, wtB]
    const batched = await GitService.getCurrentBranches(repoPath, paths)

    for (const p of paths) {
      expect(batched[p]).toBe(await GitService.getCurrentBranch(p))
    }
  })

  it('returns empty string for paths that do not exist', async () => {
    const { repoPath, wtA } = await makeRepoWithWorktrees()
    const missing = join(workRoot, 'does-not-exist')

    const branches = await GitService.getCurrentBranches(repoPath, [wtA, missing])

    expect(branches[wtA]).toBe('feature/a')
    expect(branches[missing]).toBe('')
  })

  it('falls back to per-path lookups when the repo path itself is gone', async () => {
    const { wtA } = await makeRepoWithWorktrees()

    const branches = await GitService.getCurrentBranches(join(workRoot, 'gone'), [wtA])

    expect(branches[wtA]).toBe('feature/a')
  })

  it('returns an empty record for an empty path list', async () => {
    const { repoPath } = await makeRepoWithWorktrees()
    expect(await GitService.getCurrentBranches(repoPath, [])).toEqual({})
  })
})

describe('parseWorktreeListPorcelain', () => {
  it('parses branch, detached, and bare entries', () => {
    const output = [
      'worktree /repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /repo-wt',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      '',
      'worktree /repo-bare',
      'bare',
    ].join('\n')

    const parsed = parseWorktreeListPorcelain(output)

    expect(parsed).toEqual([
      { path: '/repo', branch: 'main', head: '1111111111111111111111111111111111111111', isBare: false, isDetached: undefined },
      { path: '/repo-wt', branch: '', head: '2222222222222222222222222222222222222222', isBare: false, isDetached: true },
      { path: '/repo-bare', branch: '', head: '', isBare: true, isDetached: undefined },
    ])
  })
})
