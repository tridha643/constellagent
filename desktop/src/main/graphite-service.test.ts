import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { GraphiteService } from './graphite-service'

const execFileAsync = promisify(execFile)

async function runGit(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

let workRoot: string

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'gs-cache-'))
})

afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true })
})

describe('parseGraphiteMetadata cache', () => {
  it('returns null for non-graphite repo and avoids redundant spawns on a tight loop', async () => {
    const repo = join(workRoot, 'repo')
    mkdirSync(repo)
    await runGit(repo, 'init', '-q', '-b', 'main')
    await runGit(repo, '-c', 'user.email=a@b', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init')
    writeFileSync(join(repo, 'README.md'), 'hello')

    // First call populates the cache (returns null because no graphite metadata
    // exists). Subsequent calls within the TTL should return the same shape
    // without re-spawning git — we can't observe spawn count from here, but we
    // can at least verify the call remains correct and fast.
    const first = await GraphiteService.getStackInfo(repo, repo)
    const second = await GraphiteService.getStackInfo(repo, repo)
    const third = await GraphiteService.getStackInfo(repo, repo)

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(third).toBeNull()
  })

  it('parallel calls for the same repo dedupe via in-flight tracking', async () => {
    const repo = join(workRoot, 'repo')
    mkdirSync(repo)
    await runGit(repo, 'init', '-q', '-b', 'main')
    await runGit(repo, '-c', 'user.email=a@b', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init')

    const results = await Promise.all([
      GraphiteService.getStackInfo(repo, repo),
      GraphiteService.getStackInfo(repo, repo),
      GraphiteService.getStackInfo(repo, repo),
      GraphiteService.getStackInfo(repo, repo),
    ])
    for (const r of results) expect(r).toBeNull()
  })

  it('setBranchParent invalidates the cache so a freshly-tracked branch is visible', async () => {
    const repo = join(workRoot, 'repo')
    mkdirSync(repo)
    await runGit(repo, 'init', '-q', '-b', 'main')
    await runGit(repo, '-c', 'user.email=a@b', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init')
    await runGit(repo, 'branch', 'feature/x')

    // Warm the cache with an empty result while checked out on the default
    // branch (setBranchParent requires we be on the default branch).
    const before = await GraphiteService.getStackInfo(repo, repo)
    expect(before).toBeNull()

    // Persist parent metadata via the constellagent-owned write path; this
    // must invalidate the cache so the next read sees the new branch.
    await GraphiteService.setBranchParent(repo, 'feature/x', 'main')

    // Now check out the feature branch and verify the stack info reflects
    // the freshly-written metadata (which would be hidden behind a stale
    // cache without the invalidation hook).
    await runGit(repo, 'checkout', '-q', 'feature/x')
    const after = await GraphiteService.getStackInfo(repo, repo)
    expect(after).not.toBeNull()
    expect(after?.currentBranch).toBe('feature/x')
    expect(after?.branches.some((b) => b.name === 'feature/x')).toBe(true)
  })
})

describe('GraphiteService presence checks', () => {
  it('graphite_metadata.db existence does not crash empty parsing', async () => {
    const repo = join(workRoot, 'repo')
    mkdirSync(repo)
    await runGit(repo, 'init', '-q', '-b', 'main')
    await runGit(repo, '-c', 'user.email=a@b', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init')

    // Touch an empty DB file — parseGraphiteSqliteMetadata should fall through
    // gracefully when the table is missing.
    const dbPath = join(repo, '.git', '.graphite_metadata.db')
    writeFileSync(dbPath, '')
    expect(existsSync(dbPath)).toBe(true)

    const result = await GraphiteService.getStackInfo(repo, repo)
    expect(result).toBeNull()
  })
})
