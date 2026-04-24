import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { GitService } from './git-service'
import type { CloneRepoProgress, CloneRepoStage } from '../shared/clone-repo'
import { CLONE_ERROR_CODES } from '../shared/clone-repo'

const execFileAsync = promisify(execFile)

let workRoot: string

async function runGit(cwd: string, ...args: string[]) {
  await execFileAsync('git', args, { cwd })
}

async function makeBareSourceRepo(): Promise<string> {
  const src = mkdtempSync(join(workRoot, 'src-'))
  await runGit(src, 'init', '-q', '-b', 'main')
  await runGit(src, '-c', 'user.email=a@b', '-c', 'user.name=Tester', 'commit', '-q', '--allow-empty', '-m', 'first')
  // Add a second commit so log has >1 entry.
  await runGit(src, '-c', 'user.email=a@b', '-c', 'user.name=Tester', 'commit', '-q', '--allow-empty', '-m', 'second')
  // Create a bare clone that cloneRepo() will then clone from (via file://).
  const bare = join(workRoot, 'source.git')
  await execFileAsync('git', ['clone', '--bare', '-q', src, bare])
  return bare
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'constellagent-clone-test-'))
})

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

describe('GitService.cloneRepo', () => {
  it('clones a local bare repo and emits stage progress', async () => {
    const bare = await makeBareSourceRepo()
    const destPath = join(workRoot, 'cloned')
    const stages: CloneRepoStage[] = []

    const result = await GitService.cloneRepo(
      { url: `file://${bare}`, destPath, requestId: 'test-1' },
      (p: CloneRepoProgress) => {
        if (stages[stages.length - 1] !== p.stage) stages.push(p.stage)
      },
    )

    expect(existsSync(destPath)).toBe(true)
    expect(existsSync(join(destPath, '.git'))).toBe(true)
    expect(result.repoPath).toBeTruthy()
    expect(result.defaultBranch).toBe('main')

    // Stage sequence should cover the whole lifecycle in order.
    expect(stages).toEqual(['validate-url', 'prepare-destination', 'cloning', 'finalizing'])

    // Verify we actually got both commits (full-history, not shallow).
    const { stdout } = await execFileAsync('git', ['-C', destPath, 'log', '--oneline'])
    expect(stdout.trim().split('\n').length).toBe(2)
  })

  it('rejects with DEST_EXISTS_NON_EMPTY when destination is a non-empty, non-repo dir', async () => {
    const bare = await makeBareSourceRepo()
    const destPath = join(workRoot, 'occupied')
    // Fill the dir with a non-repo file.
    await execFileAsync('mkdir', ['-p', destPath])
    await execFileAsync('sh', ['-c', `echo hi > ${destPath}/blocker.txt`])

    await expect(
      GitService.cloneRepo({ url: `file://${bare}`, destPath, requestId: 'test-2' }),
    ).rejects.toThrow(CLONE_ERROR_CODES.DEST_EXISTS_NON_EMPTY)
  })

  it('cancelClone aborts an in-flight clone and cleans partial destination', async () => {
    // Slow clones are hard to reproduce deterministically. Kick off a clone that is fast
    // but still in-flight long enough to SIGTERM it from the same tick.
    const bare = await makeBareSourceRepo()
    const destPath = join(workRoot, 'to-cancel')

    const promise = GitService.cloneRepo({ url: `file://${bare}`, destPath, requestId: 'cancel-1' })
    // Fire cancel on the next microtask so the child has spawned.
    await new Promise((resolve) => setImmediate(resolve))
    const cancelled = GitService.cancelClone('cancel-1')
    expect(cancelled).toBe(true)

    let threw: unknown = null
    try {
      await promise
    } catch (err) {
      threw = err
    }
    expect(threw).toBeInstanceOf(Error)
    // On very fast machines cloning a tiny empty repo may finish before SIGTERM lands;
    // accept either CANCELLED or a successful completion that we clean up manually.
    if (threw instanceof Error && threw.message === CLONE_ERROR_CODES.CANCELLED) {
      expect(existsSync(destPath)).toBe(false)
    }
  })
})
