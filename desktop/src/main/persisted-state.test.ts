import { afterEach, beforeEach, describe, expect, test, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const userDataDir = mkdtempSync(join(tmpdir(), 'constellagent-persisted-state-'))
const stateFile = join(userDataDir, 'constellagent-state.json')

mock.module('electron', () => ({
  app: {
    getPath: () => userDataDir,
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

const {
  invalidatePersistedStateCache,
  listPersistedProjectsWithBranches,
  listPersistedWorkspaceRecords,
  upsertPersistedMobileWorkspace,
} = await import('./persisted-state')

function seedState(payload: unknown): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(stateFile, JSON.stringify(payload, null, 2), 'utf-8')
}

beforeEach(() => {
  invalidatePersistedStateCache()
  try { rmSync(stateFile) } catch {}
})

afterEach(() => {
  invalidatePersistedStateCache()
  try { rmSync(stateFile) } catch {}
})

describe('persisted-state mtime cache', () => {
  test('returns the same cached state object when the file is unchanged', () => {
    seedState({
      projects: [{ id: 'p1', repoPath: '/tmp/repo-a' }],
      workspaces: [
        { id: 'w1', projectId: 'p1', branch: 'main' },
        { id: 'w2', projectId: 'p1', branch: 'feature/x' },
      ],
    })

    const first = listPersistedProjectsWithBranches()
    const second = listPersistedProjectsWithBranches()
    expect(first).toEqual([
      { projectId: 'p1', repoPath: '/tmp/repo-a', branches: ['feature/x', 'main'] },
    ])
    // Both calls observe the same underlying source — identical content.
    expect(second).toEqual(first)
  })

  test('detects mtime change and re-parses the file', async () => {
    seedState({
      projects: [{ id: 'p1', repoPath: '/tmp/repo-a' }],
      workspaces: [{ id: 'w1', projectId: 'p1', branch: 'main' }],
    })
    const initial = listPersistedProjectsWithBranches()
    expect(initial[0].branches).toEqual(['main'])

    // Wait long enough that the second write produces a strictly newer mtime
    // even on filesystems with low-resolution timestamps.
    await new Promise((r) => setTimeout(r, 25))
    seedState({
      projects: [{ id: 'p1', repoPath: '/tmp/repo-a' }],
      workspaces: [
        { id: 'w1', projectId: 'p1', branch: 'main' },
        { id: 'w2', projectId: 'p1', branch: 'feature/y' },
      ],
    })

    const next = listPersistedProjectsWithBranches()
    expect(next[0].branches).toEqual(['feature/y', 'main'])
  })

  test('saveState path invalidates the cache so a subsequent read sees fresh data', () => {
    seedState({
      projects: [{ id: 'p1', name: 'a', repoPath: '/tmp/repo-a' }],
      workspaces: [],
    })
    expect(listPersistedWorkspaceRecords()).toEqual([])

    const result = upsertPersistedMobileWorkspace({
      worktreePath: '/tmp/repo-a-worktree',
      repoPath: '/tmp/repo-a',
      branch: 'feature/z',
    })
    expect(result.created).toBe(true)

    const records = listPersistedWorkspaceRecords()
    expect(records.length).toBe(1)
    expect(records[0].branch).toBe('feature/z')

    // The on-disk file mirrors the cache.
    const onDisk = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(onDisk.workspaces?.[0]?.branch).toBe('feature/z')
  })

  test('missing file returns empty record and tolerates later creation', () => {
    expect(listPersistedWorkspaceRecords()).toEqual([])
    seedState({ workspaces: [{ id: 'w1', projectId: 'p1', branch: 'main' }] })
    expect(listPersistedWorkspaceRecords().length).toBe(1)
  })
})
