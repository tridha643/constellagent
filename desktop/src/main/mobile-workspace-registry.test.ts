import { describe, expect, test, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

mock.module('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'constellagent-workspace-registry-test'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

import {
  extractManagedWorktreeToken,
  isManagedWorktreePath,
} from './mobile-workspace-registry'

describe('mobile-workspace-registry', () => {
  test('extractManagedWorktreeToken recognizes constellagent managed worktrees', () => {
    const path = '/Users/me/repo/.constellagent/worktrees/a1b2c3d4'
    expect(extractManagedWorktreeToken(path)).toBe('a1b2c3d4')
    expect(isManagedWorktreePath(path)).toBe(true)
  })

  test('extractManagedWorktreeToken ignores unrelated paths', () => {
    expect(extractManagedWorktreeToken('/tmp/foo')).toBeNull()
    expect(isManagedWorktreePath('/tmp/foo')).toBe(false)
  })
})
