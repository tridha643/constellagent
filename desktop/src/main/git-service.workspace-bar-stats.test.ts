import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { GitService } from './git-service'

const execFileAsync = promisify(execFile)

let workRoot: string

async function runGit(cwd: string, ...args: string[]) {
  await execFileAsync('git', args, { cwd })
}

async function initRepo(): Promise<string> {
  const repoPath = mkdtempSync(join(workRoot, 'repo-'))
  await runGit(repoPath, 'init', '-q', '-b', 'main')
  await runGit(repoPath, 'config', 'user.email', 'a@b.test')
  await runGit(repoPath, 'config', 'user.name', 'Tester')
  writeFileSync(join(repoPath, 'base.txt'), 'a\nb\nc\n')
  await runGit(repoPath, 'add', '.')
  await runGit(repoPath, 'commit', '-q', '-m', 'base')
  return repoPath
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'constellagent-wsbar-test-'))
})

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

describe('GitService.getWorkspaceBarStats', () => {
  it('reports the latest commit subject and WIP-only (vs HEAD) +N -N', async () => {
    const repoPath = await initRepo()

    // Branch ahead of base with a committed change — these committed lines must
    // NOT count toward the bar numstat (WIP scope is working tree vs HEAD).
    await runGit(repoPath, 'checkout', '-q', '-b', 'feature')
    appendFileSync(join(repoPath, 'base.txt'), 'd\ne\n') // +2, committed
    await runGit(repoPath, 'commit', '-q', '-am', 'feature: add lines')

    // Working tree: one staged new file (+1), one unstaged edit (+1 more).
    writeFileSync(join(repoPath, 'staged.txt'), 'x\n')
    await runGit(repoPath, 'add', 'staged.txt')
    appendFileSync(join(repoPath, 'base.txt'), 'f\n')

    const stats = await GitService.getWorkspaceBarStats(repoPath, 'main')

    expect(stats.subject).toBe('feature: add lines')
    expect(stats.headSha).toMatch(/^[0-9a-f]{40}$/)
    // WIP vs HEAD only: base.txt +1 (f) and staged.txt +1 — the committed d,e
    // are excluded.
    expect(stats.additions).toBe(2)
    expect(stats.deletions).toBe(0)
  })

  it('returns +0 -0 and no subject for a branch with no commits of its own', async () => {
    const repoPath = await initRepo()
    await runGit(repoPath, 'checkout', '-q', '-b', 'clean')

    const stats = await GitService.getWorkspaceBarStats(repoPath, 'main')

    expect(stats.subject).toBe('')
    expect(stats.additions).toBe(0)
    expect(stats.deletions).toBe(0)
    expect(stats.headSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('counts deletions in the working tree', async () => {
    const repoPath = await initRepo()
    await runGit(repoPath, 'checkout', '-q', '-b', 'shrink')
    writeFileSync(join(repoPath, 'base.txt'), 'a\n') // remove b and c (−2)

    const stats = await GitService.getWorkspaceBarStats(repoPath, 'main')

    expect(stats.additions).toBe(0)
    expect(stats.deletions).toBe(2)
  })

  it('returns empty stats for a non-existent worktree path', async () => {
    const stats = await GitService.getWorkspaceBarStats(join(workRoot, 'nope'))
    expect(stats).toEqual({ subject: '', additions: 0, deletions: 0, headSha: '' })
  })
})
