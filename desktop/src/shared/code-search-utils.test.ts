import { describe, expect, it } from 'bun:test'
import { buildCodeSearchPreview, isDeveloperCodeSearchPath, sortAndCapCodeSearchItems } from './code-search-utils'

describe('isDeveloperCodeSearchPath', () => {
  it('includes code, config, and script files', () => {
    expect(isDeveloperCodeSearchPath('src/main/file-service.ts')).toBe(true)
    expect(isDeveloperCodeSearchPath('.github/workflows/ci.yml')).toBe(true)
    expect(isDeveloperCodeSearchPath('Dockerfile')).toBe(true)
    expect(isDeveloperCodeSearchPath('.env.local')).toBe(true)
  })

  it('excludes docs and prose-heavy files', () => {
    expect(isDeveloperCodeSearchPath('README.md')).toBe(false)
    expect(isDeveloperCodeSearchPath('docs/setup.ts')).toBe(false)
    expect(isDeveloperCodeSearchPath('documentation/reference.json')).toBe(false)
    expect(isDeveloperCodeSearchPath('CHANGELOG.mdx')).toBe(false)
  })
})

describe('sortAndCapCodeSearchItems', () => {
  it('orders matches by preferred path order and applies caps', () => {
    const items = [
      { path: '/repo/src/b.ts', relativePath: 'src/b.ts', lineNumber: 20, column: 3 },
      { path: '/repo/src/a.ts', relativePath: 'src/a.ts', lineNumber: 5, column: 1 },
      { path: '/repo/src/a.ts', relativePath: 'src/a.ts', lineNumber: 7, column: 2 },
      { path: '/repo/src/c.ts', relativePath: 'src/c.ts', lineNumber: 1, column: 1 },
    ]

    const result = sortAndCapCodeSearchItems(items, {
      limit: 2,
      maxMatchesPerFile: 1,
      preferredPathOrder: ['/repo/src/b.ts', '/repo/src/a.ts'],
    })

    expect(result.items).toEqual([
      { path: '/repo/src/b.ts', relativePath: 'src/b.ts', lineNumber: 20, column: 3 },
      { path: '/repo/src/a.ts', relativePath: 'src/a.ts', lineNumber: 5, column: 1 },
    ])
    expect(result.totalMatched).toBe(2)
    expect(result.hasMore).toBe(true)
  })
})

describe('buildCodeSearchPreview', () => {
  it('trims long previews around the first match and rewrites ranges', () => {
    const longLine = `${'x'.repeat(140)}needle${'y'.repeat(140)}`
    const start = 140
    const end = start + 'needle'.length

    const preview = buildCodeSearchPreview(longLine, [[start, end]], 80)

    expect(preview.preview.length).toBeLessThanOrEqual(82)
    expect(preview.preview.includes('needle')).toBe(true)
    expect(preview.matchRanges[0]).toBeDefined()
    expect(preview.previewTruncated).toBe(true)
  })
})
