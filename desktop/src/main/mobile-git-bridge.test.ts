import { describe, expect, test, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MobileGitBridgeError } from './mobile-git-bridge'

mock.module('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'constellagent-git-bridge-test'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

const {
  __testing,
  handleMobileGitBridgeMethod,
  isMobileGitBridgeMethod,
} = await import('./mobile-git-bridge')

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

  test('mobile git subprocesses disable interactive credential prompts', () => {
    const env = __testing.nonInteractiveGitEnv({ PATH: '/usr/bin', HOME: '/tmp/home' })

    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/tmp/home')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_ASKPASS).toBe('echo')
    expect(env.SSH_ASKPASS).toBe('echo')
  })
})
