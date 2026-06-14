import { afterEach, describe, expect, it } from 'bun:test'
import { GitService, type FileStatus } from './git-service'

// getStatusCached delegates to GitService.getStatus; override it so the cache
// behaviour can be tested deterministically without spawning git.
const ORIGINAL_GET_STATUS = GitService.getStatus

function stubGetStatus(impl: (worktreePath: string) => Promise<FileStatus[]>): void {
  ;(GitService as unknown as { getStatus: typeof GitService.getStatus }).getStatus =
    impl as typeof GitService.getStatus
}

afterEach(() => {
  ;(GitService as unknown as { getStatus: typeof GitService.getStatus }).getStatus = ORIGINAL_GET_STATUS
  GitService.invalidateStatusCache() // drop everything between tests
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('GitService.getStatusCached', () => {
  it('coalesces concurrent callers within the TTL into one getStatus', async () => {
    let calls = 0
    stubGetStatus(async () => {
      calls += 1
      await sleep(10)
      return []
    })

    await Promise.all(Array.from({ length: 5 }, () => GitService.getStatusCached('/repo')))
    expect(calls).toBe(1)
  })

  it('recomputes after invalidateStatusCache for the worktree', async () => {
    let calls = 0
    stubGetStatus(async () => { calls += 1; return [] })

    await GitService.getStatusCached('/repo')
    expect(calls).toBe(1)

    GitService.invalidateStatusCache('/repo')
    await GitService.getStatusCached('/repo')
    expect(calls).toBe(2)
  })

  it('invalidates by a file path under the worktree (file-mutation hook)', async () => {
    let calls = 0
    stubGetStatus(async () => { calls += 1; return [] })

    await GitService.getStatusCached('/repo')
    GitService.invalidateStatusCache('/repo/src/app.ts')
    await GitService.getStatusCached('/repo')

    expect(calls).toBe(2)
  })

  it('does not invalidate an unrelated worktree', async () => {
    let calls = 0
    stubGetStatus(async () => { calls += 1; return [] })

    await GitService.getStatusCached('/repo-a')
    GitService.invalidateStatusCache('/repo-b/file.ts')
    await GitService.getStatusCached('/repo-a') // still cached

    expect(calls).toBe(1)
  })

  it('never caches a rejection (transient failures self-heal)', async () => {
    let calls = 0
    stubGetStatus(async () => {
      calls += 1
      throw new Error('boom')
    })

    await expect(GitService.getStatusCached('/repo')).rejects.toThrow('boom')
    await expect(GitService.getStatusCached('/repo')).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })
})
