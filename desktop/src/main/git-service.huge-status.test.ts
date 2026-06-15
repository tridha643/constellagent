import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from './git-service'

// Regression guard for the "Changes tab hides files in huge repos" bug.
//
// `getStatus` used `git status -unormal` on repos over the huge-file threshold.
// `-unormal` collapses untracked files inside an untracked directory into a
// single `dir/` entry, so a new folder of N files showed as ONE row — the
// Changes tab silently dropped most changes. getStatus must always use `-uall`
// so every individual changed file is listed regardless of repo size.

const ORIGINAL_IS_HUGE = GitService.isRepositoryHuge

function stubHuge(value: boolean): void {
  ;(GitService as unknown as { isRepositoryHuge: typeof GitService.isRepositoryHuge }).isRepositoryHuge =
    (async () => value) as typeof GitService.isRepositoryHuge
}

function makeRepoWithUntrackedDir(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'huge-status-')))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), 'seed\n')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo })
  // A brand-new untracked directory with several files — the exact shape that
  // `-unormal` collapses into a single `tools/` entry.
  mkdirSync(join(repo, 'tools', 'nested'), { recursive: true })
  for (const name of ['a.py', 'b.py', 'c.py']) writeFileSync(join(repo, 'tools', name), 'x\n')
  writeFileSync(join(repo, 'tools', 'nested', 'd.py'), 'x\n')
  return repo
}

afterEach(() => {
  ;(GitService as unknown as { isRepositoryHuge: typeof GitService.isRepositoryHuge }).isRepositoryHuge =
    ORIGINAL_IS_HUGE
})

describe('GitService.getStatus on huge repos', () => {
  it('lists every untracked file inside a new directory (no -unormal collapse)', async () => {
    const repo = makeRepoWithUntrackedDir()
    try {
      stubHuge(true)
      const statuses = await GitService.getStatus(repo)
      const paths = statuses.map((s) => s.path).sort()
      expect(paths).toEqual([
        'tools/a.py',
        'tools/b.py',
        'tools/c.py',
        'tools/nested/d.py',
      ])
      // The directory itself must never appear as a status row.
      expect(paths).not.toContain('tools/')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('matches the non-huge result file-for-file', async () => {
    const repo = makeRepoWithUntrackedDir()
    try {
      stubHuge(false)
      const normal = (await GitService.getStatus(repo)).map((s) => s.path).sort()
      stubHuge(true)
      const huge = (await GitService.getStatus(repo)).map((s) => s.path).sort()
      expect(huge).toEqual(normal)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
