import { describe, expect, it } from 'bun:test'
import {
  deriveBucket,
  ensureDefaultCustomSections,
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
  const folders = () => [
    { id: 'non-priority', projectId: 'project-1', name: 'Non-priority', order: 1, isDefault: true },
    { id: 'priority', projectId: 'project-1', name: 'Priority', order: 0 },
  ]

  it('renders only the folders, in order, all custom — no pinned/auto buckets', () => {
    const sections = getWorkspaceSections([], noSignals, NOW, folders())
    expect(sections.map((s) => s.id)).toEqual(['priority', 'non-priority'])
    expect(sections.map((s) => s.kind)).toEqual(['custom', 'custom'])
    expect(sections.find((s) => s.id === 'non-priority')?.isDefault).toBe(true)
  })

  it('routes unassigned workspaces into the default (Non-priority) folder, ignoring status signals', () => {
    const workspaces = [
      workspace('assigned', { sectionId: 'priority' }),
      workspace('loose', {}),
    ]
    // `loose` would have been needs-you under the old buckets; now it just lands in the default.
    const signals: Record<string, WorkspaceSignals> = {
      assigned: { unread: true },
      loose: { unread: true },
    }
    const sections = getWorkspaceSections(workspaces, (w) => signals[w.id] ?? {}, NOW, folders())
    expect(sections.find((s) => s.id === 'priority')?.workspaces.map((w) => w.id)).toEqual(['assigned'])
    expect(sections.find((s) => s.id === 'non-priority')?.workspaces.map((w) => w.id)).toEqual(['loose'])
  })

  it('falls back to the default folder when a sectionId no longer exists', () => {
    const workspaces = [workspace('orphan', { sectionId: 'gone' })]
    const sections = getWorkspaceSections(workspaces, () => ({}), NOW, folders())
    expect(sections.find((s) => s.id === 'non-priority')?.workspaces.map((w) => w.id)).toEqual(['orphan'])
  })

  it('orders within a folder by lastActiveAt desc, then name', () => {
    const workspaces = [
      workspace('older', { name: 'older', lastActiveAt: NOW - 5000 }),
      workspace('newer', { name: 'newer', lastActiveAt: NOW - 1000 }),
      workspace('zeb', { name: 'zeb' }),
      workspace('abe', { name: 'abe' }),
    ]
    const sections = getWorkspaceSections(workspaces, noSignals, NOW, folders())
    const def = sections.find((s) => s.id === 'non-priority')!
    expect(def.workspaces.map((w) => w.id)).toEqual(['newer', 'older', 'abe', 'zeb'])
  })

  it('synthesizes a Non-priority folder when a project has no folders yet', () => {
    const sections = getWorkspaceSections([workspace('a')], noSignals, NOW, [])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.label).toBe('Non-priority')
    expect(sections[0]!.isDefault).toBe(true)
    expect(sections[0]!.workspaces.map((w) => w.id)).toEqual(['a'])
  })
})

describe('ensureDefaultCustomSections', () => {
  it('seeds Priority + Non-priority for projects with no folders, and leaves seeded ones alone', () => {
    const existing = [{ id: 's1', projectId: 'p-has', name: 'Mine', order: 0 }]
    const out = ensureDefaultCustomSections([{ id: 'p-has' }, { id: 'p-new' }], existing)
    expect(out.filter((s) => s.projectId === 'p-has')).toEqual(existing)
    const seeded = out.filter((s) => s.projectId === 'p-new')
    expect(seeded.map((s) => s.name)).toEqual(['Priority', 'Non-priority'])
    expect(seeded.find((s) => s.name === 'Non-priority')?.isDefault).toBe(true)
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
