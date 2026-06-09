import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { GitService } from './git-service'

const execFileAsync = promisify(execFile)

let workRoot: string

async function runGit(cwd: string, ...args: string[]) {
  await execFileAsync('git', args, { cwd })
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'constellagent-remove-wt-test-'))
})

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

async function makeRepoWithWorktree(): Promise<{ repoPath: string; worktreePath: string }> {
  const repoPath = join(workRoot, 'repo')
  const worktreePath = join(workRoot, 'linked-wt')
  mkdirSync(repoPath, { recursive: true })
  await runGit(repoPath, 'init', '-q', '-b', 'main')
  await runGit(
    repoPath,
    '-c',
    'user.email=a@b',
    '-c',
    'user.name=Tester',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  )
  await runGit(repoPath, 'branch', 'feature')
  await runGit(repoPath, 'worktree', 'add', worktreePath, 'feature')
  return { repoPath, worktreePath }
}

describe('GitService.removeWorktreeForDelete', () => {
  it('no-ops when the worktree path does not exist', async () => {
    const repoPath = join(workRoot, 'repo')
    mkdirSync(repoPath, { recursive: true })
    await runGit(repoPath, 'init', '-q', '-b', 'main')

    await expect(
      GitService.removeWorktreeForDelete(repoPath, join(workRoot, 'missing-wt')),
    ).resolves.toBeUndefined()
  })

  it('removes a registered linked worktree', async () => {
    const { repoPath, worktreePath } = await makeRepoWithWorktree()
    expect(existsSync(worktreePath)).toBe(true)

    await GitService.removeWorktreeForDelete(repoPath, worktreePath)

    expect(existsSync(worktreePath)).toBe(false)
    const listed = await GitService.listWorktrees(repoPath)
    expect(listed.some((entry) => entry.path === worktreePath)).toBe(false)
  })

  it('cleans up a plain directory that is no longer a registered worktree', async () => {
    const { repoPath, worktreePath } = await makeRepoWithWorktree()
    rmSync(worktreePath, { recursive: true, force: true })
    await runGit(repoPath, 'worktree', 'prune')
    mkdirSync(worktreePath, { recursive: true })

    await GitService.removeWorktreeForDelete(repoPath, worktreePath)

    expect(existsSync(worktreePath)).toBe(false)
  })

  it('refuses to delete the primary repository directory', async () => {
    const repoPath = join(workRoot, 'repo')
    mkdirSync(repoPath, { recursive: true })
    await runGit(repoPath, 'init', '-q', '-b', 'main')

    await expect(GitService.removeWorktreeForDelete(repoPath, repoPath)).rejects.toThrow(
      /primary repository directory/i,
    )
  })
})
