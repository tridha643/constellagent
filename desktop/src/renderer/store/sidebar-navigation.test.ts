import { describe, expect, it } from 'bun:test'
import {
  deriveBucket,
  getRenderableProjectWorkspaces,
  getWorkspaceSections,
  resolveProjectTargetWorkspace,
  type WorkspaceSignals,
} from './sidebar-navigation'
import { preserveWorkspaceBranch } from './workspace-branch'
import type { Workspace } from './types'
import type { PrInfo } from '../../shared/github-types'

const NOW = 1_000_000_000_000

function pr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 1,
    state: 'open',
    title: 'PR',
    url: 'https://example.com/pr/1',
    checkStatus: 'passing',
    hasPendingComments: false,
    pendingCommentCount: 0,
    isBlockedByCi: false,
    isApproved: false,
    isChangesRequested: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name: id,
    branch: id,
    worktreePath: `/tmp/${id}`,
    projectId: 'project-1',
    ...overrides,
  }
}

describe('sidebar navigation workspace visibility', () => {
  it('keeps detached-head workspaces visible within their project', () => {
    const workspaces: Workspace[] = [
      workspace('ws-conflict', { name: 'feature-a', branch: 'HEAD' }),
      workspace('ws-other', { name: 'feature-b', branch: 'feature-b' }),
    ]

    expect(getRenderableProjectWorkspaces(workspaces, 'project-1').map((w) => w.id)).toEqual([
      'ws-conflict',
      'ws-other',
    ])
  })

  it('can still target the last active workspace when its branch is temporarily HEAD', () => {
    const workspaces: Workspace[] = [workspace('ws-conflict', { name: 'feature-a', branch: 'HEAD' })]

    expect(resolveProjectTargetWorkspace('project-1', workspaces, { 'project-1': 'ws-conflict' })?.id).toBe(
      'ws-conflict',
    )
  })
})

describe('deriveBucket', () => {
  it('routes a failing-CI worktree to needs-you even with an open PR', () => {
    expect(deriveBucket({ pr: pr({ state: 'open', checkStatus: 'failing' }) }, NOW)).toBe('needs-you')
    expect(deriveBucket({ pr: pr({ state: 'open', isBlockedByCi: true }) }, NOW)).toBe('needs-you')
    expect(deriveBucket({ pr: pr({ state: 'open', isChangesRequested: true }) }, NOW)).toBe('needs-you')
  })

  it('routes merge conflicts and spotlight errors to needs-you', () => {
    expect(deriveBucket({ sync: { workspaceId: 'a', status: 'conflict' } }, NOW)).toBe('needs-you')
    expect(deriveBucket({ sync: { workspaceId: 'a', status: 'error' } }, NOW)).toBe('needs-you')
    expect(
      deriveBucket({ spotlight: { projectId: 'p', workspaceId: 'a', state: 'blocked' } }, NOW),
    ).toBe('needs-you')
  })

  it('treats unread output as the agent-waiting needs-you proxy', () => {
    expect(deriveBucket({ unread: true }, NOW)).toBe('needs-you')
  })

  it('routes a healthy open PR to in-review', () => {
    expect(deriveBucket({ pr: pr({ state: 'open', checkStatus: 'passing' }) }, NOW)).toBe('in-review')
    expect(deriveBucket({ pr: pr({ state: 'open', isApproved: true }) }, NOW)).toBe('in-review')
  })

  it('routes recent activity / local changes / active agent to active', () => {
    expect(deriveBucket({ lastActiveAt: NOW - 1000 }, NOW)).toBe('active')
    expect(deriveBucket({ barStats: { subject: 's', additions: 3, deletions: 0 } }, NOW)).toBe('active')
    expect(deriveBucket({ agentActive: true }, NOW)).toBe('active')
    expect(
      deriveBucket({ spotlight: { projectId: 'p', workspaceId: 'a', state: 'watching' } }, NOW),
    ).toBe('active')
  })

  it('routes merged PRs and stale workspaces to idle', () => {
    expect(deriveBucket({}, NOW)).toBe('idle')
    expect(deriveBucket({ pr: pr({ state: 'merged' }) }, NOW)).toBe('idle')
    // A merged PR is idle even if recently touched.
    expect(deriveBucket({ pr: pr({ state: 'merged' }), lastActiveAt: NOW - 1000 }, NOW)).toBe('idle')
    // Touched > 24h ago → idle.
    expect(deriveBucket({ lastActiveAt: NOW - 25 * 60 * 60 * 1000 }, NOW)).toBe('idle')
  })
})

describe('getWorkspaceSections', () => {
  const noSignals = (): WorkspaceSignals => ({})

  it('always renders pinned, custom sections (in order), then all buckets', () => {
    const workspaces = [
      workspace('needs', {}),
      workspace('review', {}),
    ]
    const signals: Record<string, WorkspaceSignals> = {
      needs: { unread: true },
      review: { pr: pr({ state: 'open' }) },
    }
    const customSections = [
      { id: 'c2', projectId: 'project-1', name: 'Second', order: 1 },
      { id: 'c1', projectId: 'project-1', name: 'First', order: 0 },
    ]
    const sections = getWorkspaceSections(workspaces, (w) => signals[w.id] ?? {}, NOW, customSections)
    // Even empty sections render; customs follow Pinned in `order`.
    expect(sections.map((s) => s.id)).toEqual([
      'pinned', 'c1', 'c2', 'needs-you', 'in-review', 'active', 'idle',
    ])
    expect(sections.map((s) => s.kind)).toEqual([
      'pinned', 'custom', 'custom', 'auto', 'auto', 'auto', 'auto',
    ])
  })

  it('places a workspace in its custom section instead of an auto bucket', () => {
    const customSections = [{ id: 'c1', projectId: 'project-1', name: 'Mine', order: 0 }]
    const workspaces = [
      workspace('assigned', { sectionId: 'c1' }),
      workspace('auto', {}),
    ]
    const signals: Record<string, WorkspaceSignals> = {
      // Would be needs-you, but the section assignment wins.
      assigned: { unread: true },
      auto: { unread: true },
    }
    const sections = getWorkspaceSections(workspaces, (w) => signals[w.id] ?? {}, NOW, customSections)
    expect(sections.find((s) => s.id === 'c1')?.workspaces.map((w) => w.id)).toEqual(['assigned'])
    expect(sections.find((s) => s.id === 'needs-you')?.workspaces.map((w) => w.id)).toEqual(['auto'])
  })

  it('ignores a custom sectionId that no longer exists (falls back to auto)', () => {
    const workspaces = [workspace('orphan', { sectionId: 'gone' })]
    const sections = getWorkspaceSections(workspaces, () => ({}), NOW, [])
    expect(sections.find((s) => s.id === 'idle')?.workspaces.map((w) => w.id)).toEqual(['orphan'])
  })

  it('bucketOverride forces a workspace into the named bucket regardless of status', () => {
    const workspaces = [workspace('forced', { bucketOverride: 'idle' })]
    // Signals say needs-you, but the override pins it to idle.
    const sections = getWorkspaceSections(workspaces, () => ({ unread: true }), NOW)
    expect(sections.find((s) => s.id === 'idle')?.workspaces.map((w) => w.id)).toEqual(['forced'])
    expect(sections.find((s) => s.id === 'needs-you')?.workspaces).toEqual([])
  })

  it('excludes pinned workspaces from auto buckets and orders them by pinOrder', () => {
    const workspaces = [
      workspace('p2', { pinned: true, pinOrder: 1 }),
      workspace('p1', { pinned: true, pinOrder: 0 }),
      workspace('auto'),
    ]
    const signals: Record<string, WorkspaceSignals> = { auto: { unread: true } }
    const sections = getWorkspaceSections(workspaces, (w) => signals[w.id] ?? {}, NOW)
    expect(sections[0]!.id).toBe('pinned')
    expect(sections[0]!.workspaces.map((w) => w.id)).toEqual(['p1', 'p2'])
    // The pinned workspaces are not duplicated into needs-you.
    const needsYou = sections.find((s) => s.id === 'needs-you')
    expect(needsYou?.workspaces.map((w) => w.id)).toEqual(['auto'])
  })

  it('orders within a status section by lastActiveAt desc, then name', () => {
    const workspaces = [
      workspace('older', { name: 'older', lastActiveAt: NOW - 5000 }),
      workspace('newer', { name: 'newer', lastActiveAt: NOW - 1000 }),
      workspace('zeb', { name: 'zeb' }),
      workspace('abe', { name: 'abe' }),
    ]
    const sections = getWorkspaceSections(workspaces, noSignals, NOW)
    const idle = sections.find((s) => s.id === 'idle')!
    // newer (most recent) → older, then the two with no activity by name.
    expect(idle.workspaces.map((w) => w.id)).toEqual(['newer', 'older', 'abe', 'zeb'])
  })
})

describe('preserveWorkspaceBranch', () => {
  it('keeps the last named branch during detached-head conflict states', () => {
    expect(preserveWorkspaceBranch('feature-a', 'HEAD')).toBe('feature-a')
    expect(preserveWorkspaceBranch('feature-a', '')).toBe('feature-a')
  })

  it('accepts real branch updates when git reports a named branch again', () => {
    expect(preserveWorkspaceBranch('feature-a', 'refs/heads/feature-b')).toBe('feature-b')
  })
})
