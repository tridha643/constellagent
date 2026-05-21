import { describe, expect, it } from 'bun:test'
import { filePathToFileUrl, resolveMarkdownFileTarget, resolveMarkdownImageSrc } from './markdown-file-links'

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
})
