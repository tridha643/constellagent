import { describe, expect, it } from 'bun:test'
import { getRenderableProjectWorkspaces, resolveProjectTargetWorkspace } from './sidebar-navigation'
import { preserveWorkspaceBranch } from './workspace-branch'
import type { Workspace } from './types'

describe('sidebar navigation workspace visibility', () => {
  it('keeps detached-head workspaces visible within their project', () => {
    const workspaces: Workspace[] = [
      {
        id: 'ws-conflict',
        name: 'feature-a',
        branch: 'HEAD',
        projectId: 'project-1',
        worktreePath: '/tmp/project-1-feature-a',
      },
      {
        id: 'ws-other',
        name: 'feature-b',
        branch: 'feature-b',
        projectId: 'project-1',
        worktreePath: '/tmp/project-1-feature-b',
      },
    ]

    expect(getRenderableProjectWorkspaces(workspaces, 'project-1').map((workspace) => workspace.id)).toEqual([
      'ws-conflict',
      'ws-other',
    ])
  })

  it('can still target the last active workspace when its branch is temporarily HEAD', () => {
    const workspaces: Workspace[] = [
      {
        id: 'ws-conflict',
        name: 'feature-a',
        branch: 'HEAD',
        projectId: 'project-1',
        worktreePath: '/tmp/project-1-feature-a',
      },
    ]

    expect(resolveProjectTargetWorkspace('project-1', workspaces, { 'project-1': 'ws-conflict' })?.id).toBe(
      'ws-conflict',
    )
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
