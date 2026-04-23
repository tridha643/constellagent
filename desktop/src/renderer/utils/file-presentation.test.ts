import { describe, expect, it } from 'bun:test'
import {
  SHARED_FILE_TREE_ICONS,
  getFileGitBadge,
  getFilePresentation,
  resolveSharedFileIconToken,
} from './file-presentation'

describe('resolveSharedFileIconToken', () => {
  it('resolves common source files via pierre/trees native resolver', () => {
    expect(resolveSharedFileIconToken('src/index.ts')).toBe('typescript')
    expect(resolveSharedFileIconToken('src/App.tsx')).toBe('react')
    expect(resolveSharedFileIconToken('src/App.jsx')).toBe('react')
    expect(resolveSharedFileIconToken('README.md')).toBe('markdown')
    expect(resolveSharedFileIconToken('.env.local')).toBe('text')
  })

  it('resolves project config filenames pierre ships natively', () => {
    expect(resolveSharedFileIconToken('vite.config.ts')).toBe('vite')
    expect(resolveSharedFileIconToken('biome.json')).toBe('biome')
    expect(resolveSharedFileIconToken('.prettierrc')).toBe('prettier')
    expect(resolveSharedFileIconToken('tailwind.config.ts')).toBe('tailwind')
    expect(resolveSharedFileIconToken('.gitignore')).toBe('git')
    expect(resolveSharedFileIconToken('docker-compose.yml')).toBe('docker')
  })

  it('falls back to default for unknown file types', () => {
    expect(resolveSharedFileIconToken('weird.unknownext')).toBe('default')
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
  it('delegates resolution to pierre with the colored complete set', () => {
    expect(SHARED_FILE_TREE_ICONS.set).toBe('complete')
    expect(SHARED_FILE_TREE_ICONS.colored).toBe(true)
    expect(SHARED_FILE_TREE_ICONS.byFileName).toBeUndefined()
    expect(SHARED_FILE_TREE_ICONS.byFileExtension).toBeUndefined()
    expect(SHARED_FILE_TREE_ICONS.byFileNameContains).toBeUndefined()
  })
})
