import { describe, expect, it } from 'bun:test'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { fileChangesFromTools, filesFromTool, isMutateToolName } from './tool-file-change'

function tool(overrides: Partial<TimelineToolCall> & Pick<TimelineToolCall, 'toolName'>): TimelineToolCall {
  return {
    kind: 'tool',
    id: 't1',
    callId: 't1',
    status: 'success',
    label: 'tool',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('isMutateToolName', () => {
  it('matches patch and write tools', () => {
    expect(isMutateToolName('apply_patch')).toBe(true)
    expect(isMutateToolName('edit')).toBe(true)
    expect(isMutateToolName('write')).toBe(true)
  })

  it('does not match shell or read tools', () => {
    expect(isMutateToolName('shell')).toBe(false)
    expect(isMutateToolName('read')).toBe(false)
    expect(isMutateToolName('grep')).toBe(false)
  })
})

describe('filesFromTool', () => {
  it('returns empty for Codex shell string commands', () => {
    expect(filesFromTool(tool({ toolName: 'shell', input: 'npm test' }))).toEqual([])
    expect(filesFromTool(tool({ toolName: 'shell', input: "find diffs -g '*.d.ts'" }))).toEqual([])
  })

  it('returns empty for read tools with object path input', () => {
    expect(filesFromTool(tool({ toolName: 'read', input: { path: 'src/foo.ts' } }))).toEqual([])
  })

  it('returns Codex apply_patch changes[] paths', () => {
    expect(
      filesFromTool(
        tool({
          toolName: 'apply_patch',
          input: [{ path: 'src/a.ts', kind: 'edit' }, { path: 'src/b.ts', kind: 'add' }],
        }),
      ),
    ).toEqual([
      { path: 'src/a.ts', patch: '' },
      { path: 'src/b.ts', patch: '' },
    ])
  })

  it('preserves Codex apply_patch operation kinds', () => {
    expect(
      fileChangesFromTools([
        tool({
          toolName: 'apply_patch',
          input: [
            { path: 'src/a.ts', kind: 'update' },
            { path: 'src/b.ts', kind: 'add' },
            { path: 'src/c.ts', kind: 'delete' },
          ],
        }),
      ]),
    ).toEqual([
      { path: 'src/a.ts', patch: '', operation: 'edit' },
      { path: 'src/b.ts', patch: '', operation: 'write' },
      { path: 'src/c.ts', patch: '', operation: 'delete' },
    ])
  })

  it('returns mutate-tool object path input', () => {
    expect(filesFromTool(tool({ toolName: 'edit', input: { path: 'src/foo.ts' } }))).toEqual([
      { path: 'src/foo.ts', patch: '' },
    ])
  })

  it('returns structured fileChange output regardless of tool name', () => {
    expect(
      filesFromTool(
        tool({
          toolName: 'shell',
          output: {
            kind: 'fileChange',
            files: [{ path: 'vite.config.ts', patch: '+export default {}\n' }],
          },
        }),
      ),
    ).toEqual([{ path: 'vite.config.ts', patch: '+export default {}\n' }])
  })

  it('dedupes repeated paths and keeps the strongest operation', () => {
    expect(
      fileChangesFromTools([
        tool({ toolName: 'edit', input: { path: 'src/a.ts' } }),
        tool({ toolName: 'write', input: { path: 'src/b.ts' } }),
        tool({ toolName: 'delete_file', input: { path: 'src/a.ts' } }),
      ]),
    ).toEqual([
      { path: 'src/a.ts', patch: '', operation: 'delete' },
      { path: 'src/b.ts', patch: '', operation: 'write' },
    ])
  })
})
