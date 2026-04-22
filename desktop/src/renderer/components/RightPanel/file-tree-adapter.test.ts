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
})
