import { describe, expect, it } from 'bun:test'
import {
  filePathToFileUrl,
  findMarkdownFileReferences,
  resolveMarkdownFileTarget,
  resolveMarkdownImageSrc,
} from './markdown-file-links'

describe('markdown-file-links', () => {
  it('resolves repo-relative markdown links to absolute file targets', () => {
    expect(resolveMarkdownFileTarget('src/App.tsx#L12', { worktreePath: '/repo' })).toMatchObject({
      absolutePath: '/repo/src/App.tsx',
      displayPath: 'src/App.tsx',
      lineNumber: 12,
    })
  })

  it('does not turn external links into file chips', () => {
    expect(resolveMarkdownFileTarget('https://example.com/src/App.tsx', { worktreePath: '/repo' })).toBeNull()
  })

  it('resolves relative image paths to file urls', () => {
    expect(resolveMarkdownImageSrc('./assets/hero image.png', { baseDir: '/repo/docs' })).toBe(
      'file:///repo/docs/assets/hero%20image.png',
    )
  })

  it('keeps data image urls unchanged', () => {
    expect(resolveMarkdownImageSrc('data:image/png;base64,abc', { baseDir: '/repo' })).toBe('data:image/png;base64,abc')
  })

  it('encodes absolute paths as file urls', () => {
    expect(filePathToFileUrl('/repo/assets/hero image.png')).toBe('file:///repo/assets/hero%20image.png')
  })

  it('finds high-confidence bare file references in prose', () => {
    expect(findMarkdownFileReferences('Touched desktop/src/main/conductor-auth.ts and BrailleLoader.tsx.')).toEqual([
      { from: 8, to: 42, path: 'desktop/src/main/conductor-auth.ts' },
      { from: 47, to: 64, path: 'BrailleLoader.tsx' },
    ])
  })

  it('ignores urls and ordinary dotted words', () => {
    expect(findMarkdownFileReferences('See https://example.com/src/App.tsx and version 1.2.3.')).toEqual([])
  })
})
