import { describe, expect, test, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

mock.module('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'constellagent-git-bridge-test'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

import {
  __testing,
  handleMobileGitBridgeMethod,
  isMobileGitBridgeMethod,
  MobileGitBridgeError,
} from './mobile-git-bridge'

describe('mobile-git-bridge', () => {
  test('isMobileGitBridgeMethod recognizes slash git RPC namespace', () => {
    expect(isMobileGitBridgeMethod('git/createManagedWorktree')).toBe(true)
    expect(isMobileGitBridgeMethod('git.worktree.create')).toBe(false)
  })

  test('handleMobileGitBridgeMethod requires cwd', async () => {
    await expect(handleMobileGitBridgeMethod('git/branchesWithStatus', {})).rejects.toMatchObject({
      code: 'missing_working_directory',
    } satisfies Partial<MobileGitBridgeError>)
  })

  test('managed worktree token is 8 hex chars', () => {
    expect(__testing.managedWorktreeToken()).toMatch(/^[0-9a-f]{8}$/)
  })
})
