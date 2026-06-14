import { afterEach, describe, expect, it } from 'bun:test'
import { buildWorkingTreeStatusSignature, type GitStatusSnapshot } from '../../types/working-tree-diff'
import { loadWorkingTreeDiffFiles } from './loadWorkingTreeDiffFiles'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

function installWindow(opts: {
  onGetWorkingTreeDiff?: () => void
  fileDiff?: (path: string) => { patch: string; tooLarge: boolean }
} = {}) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        fs: { readFile: async () => 'current' },
        git: {
          getWorkingTreeDiff: async () => {
            opts.onGetWorkingTreeDiff?.()
            return ''
          },
          getFileDiff: async () => '',
          getFileDiffBounded: async (_worktree: string, path: string) =>
            opts.fileDiff?.(path) ?? { patch: '', tooLarge: false },
          showFileAtHead: async () => 'old',
        },
      },
    },
  })
}

function makeSnapshot(count: number, status: 'modified' | 'deleted' = 'deleted'): GitStatusSnapshot {
  const statuses = Array.from({ length: count }, (_, index) => ({
    path: `src/file-${index}.ts`,
    status,
    staged: false,
    additions: 0,
    deletions: index + 1,
  }))
  return {
    statuses,
    headHash: 'HEAD',
    signature: buildWorkingTreeStatusSignature(statuses, 'HEAD'),
    updatedAt: Date.now(),
  }
}

describe('loadWorkingTreeDiffFiles', () => {
  it('never fetches the whole working-tree diff (per-file lazy load)', async () => {
    let calledWholeTree = false
    installWindow({ onGetWorkingTreeDiff: () => { calledWholeTree = true } })

    await loadWorkingTreeDiffFiles({
      worktreePath: '/repo',
      source: 'diff-viewer',
      statusSnapshot: makeSnapshot(4),
      concurrency: 2,
    })

    expect(calledWholeTree).toBe(false)
  })

  it('keeps progress rows stable while hydrating patches', async () => {
    installWindow()
    const snapshot = makeSnapshot(4)
    const progress: string[][] = []

    const results = await loadWorkingTreeDiffFiles({
      worktreePath: '/repo',
      source: 'diff-viewer',
      statusSnapshot: snapshot,
      concurrency: 2,
      onProgress: (files) => {
        progress.push(files.map((file) => `${file.filePath}:${file.patchLoaded === false ? 'pending' : 'loaded'}`))
      },
    })

    expect(results).toHaveLength(4)
    expect(progress.length).toBeGreaterThan(1)
    expect(progress.every((files) => files.length === 4)).toBe(true)
    expect(progress[0]).toEqual(snapshot.statuses.map((status) => `${status.path}:pending`))
    expect(progress.at(-1)).toEqual(snapshot.statuses.map((status) => `${status.path}:loaded`))
  })

  it('warms only the leading window; the rest stay status-only', async () => {
    installWindow({ fileDiff: () => ({ patch: '@@ -1 +1 @@\n-a\n+b', tooLarge: false }) })
    const snapshot = makeSnapshot(30, 'modified')

    const results = await loadWorkingTreeDiffFiles({
      worktreePath: '/repo',
      source: 'diff-viewer',
      statusSnapshot: snapshot,
      concurrency: 4,
    })

    expect(results).toHaveLength(30)
    // WARM_FILE_COUNT = 20: the first 20 are hydrated, the rest are status-only.
    expect(results.slice(0, 20).every((file) => file.patchLoaded === true)).toBe(true)
    expect(results.slice(20).every((file) => file.patchLoaded === false)).toBe(true)
    expect(results.slice(20).every((file) => file.patch === '')).toBe(true)
  })

  it('honors a warmFileCount override (summary mode warms fewer)', async () => {
    installWindow({ fileDiff: () => ({ patch: '@@ -1 +1 @@\n-a\n+b', tooLarge: false }) })
    const snapshot = makeSnapshot(30, 'modified')

    const results = await loadWorkingTreeDiffFiles({
      worktreePath: '/repo',
      source: 'diff-viewer',
      statusSnapshot: snapshot,
      warmFileCount: 5,
    })

    expect(results.filter((file) => file.patchLoaded === true)).toHaveLength(5)
  })

  it('flags files past the byte ceiling as tooLarge with no patch', async () => {
    installWindow({ fileDiff: () => ({ patch: '', tooLarge: true }) })
    const snapshot = makeSnapshot(3, 'modified')

    const results = await loadWorkingTreeDiffFiles({
      worktreePath: '/repo',
      source: 'diff-viewer',
      statusSnapshot: snapshot,
    })

    expect(results.every((file) => file.tooLarge === true)).toBe(true)
    expect(results.every((file) => file.patch === '')).toBe(true)
  })
})
