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

describe('loadWorkingTreeDiffFiles', () => {
  it('keeps progress rows stable while hydrating patches', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        api: {
          fs: {
            readFile: async () => 'current',
          },
          git: {
            getWorkingTreeDiff: async () => '',
            getFileDiff: async () => '',
            showFileAtHead: async () => 'old',
          },
        },
      },
    })

    const statuses = Array.from({ length: 4 }, (_, index) => ({
      path: `src/deleted-${index}.ts`,
      status: 'deleted' as const,
      staged: false,
      additions: 0,
      deletions: index + 1,
    }))
    const snapshot: GitStatusSnapshot = {
      statuses,
      headHash: 'HEAD',
      signature: buildWorkingTreeStatusSignature(statuses, 'HEAD'),
      updatedAt: Date.now(),
    }
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
    expect(progress[0]).toEqual(statuses.map((status) => `${status.path}:pending`))
    expect(progress.at(-1)).toEqual(statuses.map((status) => `${status.path}:loaded`))
  })
})
