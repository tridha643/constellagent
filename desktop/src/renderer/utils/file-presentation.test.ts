import { describe, expect, it } from 'bun:test'
import {
  SHARED_FILE_TREE_ICONS,
  getFileGitBadge,
  getFilePresentation,
  resolveSharedFileIconToken,
} from './file-presentation'

describe('resolveSharedFileIconToken', () => {
  it('maps common source files and configs to shared icon tokens', () => {
    expect(resolveSharedFileIconToken('src/index.ts')).toBe('typescript')
    expect(resolveSharedFileIconToken('src/App.tsx')).toBe('react')
    expect(resolveSharedFileIconToken('README.md')).toBe('markdown')
    expect(resolveSharedFileIconToken('package.json')).toBe('npm')
    expect(resolveSharedFileIconToken('.env.local')).toBe('text')
  })
})

describe('getFilePresentation', () => {
  it('returns shared icon metadata and git badges for tabs/tree rows', () => {
    const presentation = getFilePresentation('src/index.ts', 'modified')

    expect(presentation.displayTitle).toBe('index.ts')
    expect(presentation.iconToken).toBe('typescript')
    expect(presentation.iconSymbolId).toBe('file-tree-builtin-typescript')
    expect(presentation.gitBadge).toBe('M')
    expect(presentation.iconColor).toContain('--trees-file-icon-color-typescript')
  })

  it('uses shared git badge mapping', () => {
    expect(getFileGitBadge('added')).toBe('A')
    expect(getFileGitBadge('deleted')).toBe('D')
    expect(getFileGitBadge('ignored')).toBeNull()
  })
})

describe('SHARED_FILE_TREE_ICONS', () => {
  it('remaps the important file names and extensions used by the tab bar', () => {
    expect(SHARED_FILE_TREE_ICONS.set).toBe('standard')
    expect(SHARED_FILE_TREE_ICONS.colored).toBe(false)
    expect(SHARED_FILE_TREE_ICONS.byFileName?.['package.json']).toBe('file-tree-builtin-npm')
    expect(SHARED_FILE_TREE_ICONS.byFileExtension?.tsx).toBe('file-tree-builtin-react')
    expect(SHARED_FILE_TREE_ICONS.byFileNameContains?.['.env']).toBe('file-tree-builtin-text')
  })
})
