import { describe, expect, it } from 'bun:test'
import { isWriteToolName, resolveToolFileAbsolutePath, toolFileBasename } from './tool-file-path'

describe('isWriteToolName', () => {
  it('matches whole-file write tools only', () => {
    expect(isWriteToolName('write')).toBe(true)
    expect(isWriteToolName('Write_File')).toBe(true)
    expect(isWriteToolName('create_file')).toBe(true)
    expect(isWriteToolName('edit')).toBe(false)
    expect(isWriteToolName('apply_patch')).toBe(false)
  })
})

describe('resolveToolFileAbsolutePath', () => {
  const root = '/tmp/wt'

  it('joins relative paths to the worktree root', () => {
    expect(resolveToolFileAbsolutePath(root, 'src/foo.ts')).toBe('/tmp/wt/src/foo.ts')
    expect(resolveToolFileAbsolutePath(root, './src/foo.ts')).toBe('/tmp/wt/src/foo.ts')
  })

  it('preserves absolute paths', () => {
    expect(resolveToolFileAbsolutePath(root, '/var/other/file.ts')).toBe('/var/other/file.ts')
  })
})

describe('toolFileBasename', () => {
  it('returns the last path segment', () => {
    expect(toolFileBasename('src/components/App.tsx')).toBe('App.tsx')
    expect(toolFileBasename('./package.json')).toBe('package.json')
  })
})
