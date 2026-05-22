import { describe, expect, it } from 'bun:test'
import { classifyToolRegistryKey } from './tool-name-classify'

describe('classifyToolRegistryKey', () => {
  it('classifies read_file', () => {
    expect(classifyToolRegistryKey('read_file', 'Read', { path: 'a.ts' }, false)).toBe('read')
  })

  it('classifies run_terminal_cmd', () => {
    expect(classifyToolRegistryKey('run_terminal_cmd', 'Ran', { command: 'npm test' }, false)).toBe('shell')
  })

  it('classifies Codex shell string input', () => {
    expect(classifyToolRegistryKey('shell', 'Ran command', 'npm test', false)).toBe('shell')
  })

  it('prefers apply_patch when output has fileChange', () => {
    expect(
      classifyToolRegistryKey(
        'StrReplace',
        'Edited',
        {},
        true,
      ),
    ).toBe('apply_patch')
  })

  it('does not classify read path as apply_patch without fileChange output', () => {
    expect(classifyToolRegistryKey('read', 'Read', { path: 'a.ts' }, false)).toBe('read')
  })
})
