import { describe, expect, it } from 'bun:test'
import { buildFileTreeSnapshot } from './file-tree-adapter'

describe('buildFileTreeSnapshot', () => {
  it('flattens nested file-service nodes into Trees paths and git status entries', () => {
    const snapshot = buildFileTreeSnapshot('/repo', [
      {
        name: 'src',
        path: '/repo/src',
        type: 'directory',
        gitStatus: 'modified',
        children: [
          {
            name: 'index.ts',
            path: '/repo/src/index.ts',
            type: 'file',
            gitStatus: 'added',
          },
        ],
      },
      {
        name: 'README.md',
        path: '/repo/README.md',
        type: 'file',
        gitStatus: 'modified',
      },
    ])

    expect(snapshot.paths).toEqual(['src/', 'src/index.ts', 'README.md'])
    expect(snapshot.gitStatus).toEqual([
      { path: 'src/', status: 'modified' },
      { path: 'src/index.ts', status: 'added' },
      { path: 'README.md', status: 'modified' },
    ])
  })

  it('preserves empty directories so the Trees view can render them', () => {
    const snapshot = buildFileTreeSnapshot('/repo', [
      {
        name: 'docs',
        path: '/repo/docs',
        type: 'directory',
        children: [],
      },
    ])

    expect(snapshot.paths).toEqual(['docs/'])
    expect(snapshot.gitStatus).toEqual([])
  })

  it('stays linear on a large flat tree (regression: dedup was O(n²))', () => {
    const N = 20_000
    const children = Array.from({ length: N }, (_v, i) => ({
      name: `f${i}.ts`,
      path: `/repo/src/f${i}.ts`,
      type: 'file' as const,
    }))
    const t0 = performance.now()
    const snapshot = buildFileTreeSnapshot('/repo', [
      { name: 'src', path: '/repo/src', type: 'directory', children },
    ])
    const ms = performance.now() - t0

    expect(snapshot.paths.length).toBe(N + 1) // files + the src/ dir
    // O(n) finishes in a few ms; the old Array.includes/some dedup took ~2s at
    // this size. Generous ceiling guards the regression without CI flakiness.
    expect(ms).toBeLessThan(250)
  })
})
