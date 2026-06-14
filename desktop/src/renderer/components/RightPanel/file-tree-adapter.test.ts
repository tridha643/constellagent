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

  it('overlays status from the git status map and rolls it up to ancestor dirs', () => {
    const nodes = [
      {
        name: 'src',
        path: '/repo/src',
        type: 'directory' as const,
        children: [
          { name: 'index.ts', path: '/repo/src/index.ts', type: 'file' as const },
          { name: 'util.ts', path: '/repo/src/util.ts', type: 'file' as const },
        ],
      },
      { name: 'README.md', path: '/repo/README.md', type: 'file' as const },
    ]
    const map = new Map<string, string>([
      ['src/index.ts', 'modified'],
      ['README.md', 'added'],
    ])

    const snapshot = buildFileTreeSnapshot('/repo', nodes, map)

    expect(snapshot.gitStatus).toEqual([
      { path: 'src/', status: 'modified' }, // rollup: a descendant changed
      { path: 'src/index.ts', status: 'modified' },
      { path: 'README.md', status: 'added' },
    ])
    // src/util.ts is unchanged → no status entry.
    expect(snapshot.gitStatus.some((e) => e.path === 'src/util.ts')).toBe(false)
  })

  it('resolves git rename "old -> new" keys to the new path', () => {
    const map = new Map<string, string>([['src/old.ts -> src/new.ts', 'renamed']])
    const snapshot = buildFileTreeSnapshot('/repo', [
      {
        name: 'src',
        path: '/repo/src',
        type: 'directory',
        children: [{ name: 'new.ts', path: '/repo/src/new.ts', type: 'file' }],
      },
    ], map)

    expect(snapshot.gitStatus).toContainEqual({ path: 'src/new.ts', status: 'renamed' })
    expect(snapshot.gitStatus).toContainEqual({ path: 'src/', status: 'modified' })
  })

  it('treats the status map as authoritative, ignoring stale node.gitStatus', () => {
    const snapshot = buildFileTreeSnapshot('/repo', [
      { name: 'stale.ts', path: '/repo/stale.ts', type: 'file', gitStatus: 'added' },
    ], new Map<string, string>())

    // The map is empty → the node's own (stale) gitStatus must not leak through.
    expect(snapshot.gitStatus).toEqual([])
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
