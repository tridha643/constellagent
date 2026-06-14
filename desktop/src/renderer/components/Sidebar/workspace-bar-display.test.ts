import { describe, expect, it } from 'bun:test'
import {
  getWorkspaceBarLocalTitle,
  isDefaultWorkspaceBarBranch,
  normalizeWorkspaceBarBranch,
  shouldRenderWorkspaceBarStats,
  shouldRenderWorkspaceBarStatValue,
  shouldShowWorkspaceBranchMeta,
  shouldUseCompactWorkspaceBarLocalFace,
} from './workspace-bar-display'

describe('normalizeWorkspaceBarBranch', () => {
  it('normalizes local and remote branch labels', () => {
    expect(normalizeWorkspaceBarBranch('refs/heads/main')).toBe('main')
    expect(normalizeWorkspaceBarBranch('origin/main')).toBe('main')
    expect(normalizeWorkspaceBarBranch('refs/remotes/origin/main')).toBe('main')
    expect(normalizeWorkspaceBarBranch('remotes/origin/main')).toBe('main')
  })
})

describe('isDefaultWorkspaceBarBranch', () => {
  it('matches workspace branch against a normalized default branch', () => {
    expect(isDefaultWorkspaceBarBranch('main', 'origin/main')).toBe(true)
    expect(isDefaultWorkspaceBarBranch('origin/main', 'refs/remotes/origin/main')).toBe(true)
  })

  it('uses common default names only when the default branch cache is empty', () => {
    expect(isDefaultWorkspaceBarBranch('main', undefined)).toBe(true)
    expect(isDefaultWorkspaceBarBranch('master', '')).toBe(true)
    expect(isDefaultWorkspaceBarBranch('production', null)).toBe(true)
    expect(isDefaultWorkspaceBarBranch('main', 'develop')).toBe(false)
  })

  it('does not treat feature branches as default-like', () => {
    expect(isDefaultWorkspaceBarBranch('feature/sidebar', undefined)).toBe(false)
    expect(isDefaultWorkspaceBarBranch('feature/sidebar', 'main')).toBe(false)
  })
})

describe('getWorkspaceBarLocalTitle', () => {
  it('shows the branch label for the default branch instead of the commit subject', () => {
    expect(
      getWorkspaceBarLocalTitle({
        workspaceBranch: 'main',
        defaultBranch: 'origin/main',
        displayName: 'main',
        subject: 'Latest commit subject',
      }),
    ).toBe('main')
  })

  it('keeps the commit subject for non-default branches', () => {
    expect(
      getWorkspaceBarLocalTitle({
        workspaceBranch: 'feature/sidebar',
        defaultBranch: 'main',
        displayName: 'feature/sidebar',
        subject: 'Implement sidebar row',
      }),
    ).toBe('Implement sidebar row')
  })

  it('falls back to display name for non-default branches without a subject', () => {
    expect(
      getWorkspaceBarLocalTitle({
        workspaceBranch: 'feature/sidebar',
        defaultBranch: 'main',
        displayName: 'feature/sidebar',
        subject: '',
      }),
    ).toBe('feature/sidebar')
  })
})

describe('shouldUseCompactWorkspaceBarLocalFace', () => {
  it('uses compact layout when there is no commit subject', () => {
    expect(
      shouldUseCompactWorkspaceBarLocalFace({
        workspaceBranch: 'feature/sidebar',
        defaultBranch: 'main',
        displayName: 'feature/sidebar',
        subject: '',
      }),
    ).toBe(true)
  })

  it('uses the two-line layout when a branch has its own commit subject', () => {
    expect(
      shouldUseCompactWorkspaceBarLocalFace({
        workspaceBranch: 'feature/sidebar',
        defaultBranch: 'main',
        displayName: 'feature/sidebar',
        subject: 'Implement sidebar row',
      }),
    ).toBe(false)
  })

  it('uses compact layout when the mainline would repeat the branch ident', () => {
    expect(
      shouldUseCompactWorkspaceBarLocalFace({
        workspaceBranch: 'main',
        defaultBranch: 'main',
        displayName: 'main',
        subject: 'Latest on main',
      }),
    ).toBe(true)
  })
})

describe('shouldShowWorkspaceBranchMeta', () => {
  it('shows branch meta for custom workspace names', () => {
    expect(
      shouldShowWorkspaceBranchMeta({
        workspaceName: 'Terminal work',
        workspaceBranch: 'feat/terminal',
      }),
    ).toBe(true)
  })

  it('hides branch meta for auto-generated workspace names', () => {
    expect(
      shouldShowWorkspaceBranchMeta({
        workspaceName: 'ws-abc123',
        workspaceBranch: 'feat/terminal',
      }),
    ).toBe(false)
  })
})

describe('shouldRenderWorkspaceBarStatValue', () => {
  it('hides zero-valued stat sides', () => {
    expect(shouldRenderWorkspaceBarStatValue(0)).toBe(false)
    expect(shouldRenderWorkspaceBarStatValue(undefined)).toBe(false)
    expect(shouldRenderWorkspaceBarStatValue(null)).toBe(false)
  })

  it('shows only nonzero stat sides', () => {
    expect(shouldRenderWorkspaceBarStatValue(1)).toBe(true)
  })
})

describe('shouldRenderWorkspaceBarStats', () => {
  it('hides stats when there is no diff source', () => {
    expect(shouldRenderWorkspaceBarStats(false, 4, 2)).toBe(false)
  })

  it('hides zero-diff stats', () => {
    expect(shouldRenderWorkspaceBarStats(true, 0, 0)).toBe(false)
    expect(shouldRenderWorkspaceBarStats(true, undefined, undefined)).toBe(false)
  })

  it('shows stats when additions or deletions are nonzero', () => {
    expect(shouldRenderWorkspaceBarStats(true, 1, 0)).toBe(true)
    expect(shouldRenderWorkspaceBarStats(true, 0, 1)).toBe(true)
    expect(shouldRenderWorkspaceBarStats(true, 2, 3)).toBe(true)
  })
})
