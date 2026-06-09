import { describe, expect, it } from 'bun:test'
import { migrateFoldersToOverrides, stripWorkspaceFolderId } from './folder-migration'
import type { PersistedState, Workspace } from './types'

type LegacyWorkspace = Workspace & { folderId?: string }

function ws(id: string, projectId: string, folderId?: string): LegacyWorkspace {
  return {
    id,
    name: id,
    branch: id,
    worktreePath: `/tmp/${id}`,
    projectId,
    ...(folderId ? { folderId } : {}),
  }
}

describe('migrateFoldersToOverrides', () => {
  it('pins Priority-folder members and preserves their in-folder order', () => {
    const data: PersistedState = {
      projects: [
        { id: 'p1', name: 'p1', repoPath: '/tmp/p1', priorityFolderId: 'p1-prio' } as PersistedState['projects'][number],
      ],
      workspaces: [
        ws('a', 'p1', 'p1-prio'),
        ws('b', 'p1', 'p1-default'),
        ws('c', 'p1', 'p1-prio'),
      ],
      folders: [
        { id: 'p1-prio', projectId: 'p1', name: 'Priority', order: 0 },
        { id: 'p1-default', projectId: 'p1', name: 'Non-Priority', order: 1 },
      ],
    }

    const result = migrateFoldersToOverrides(data, data.workspaces)
    const byId = new Map(result.map((w) => [w.id, w]))

    expect(byId.get('a')?.pinned).toBe(true)
    expect(byId.get('c')?.pinned).toBe(true)
    expect(byId.get('b')?.pinned).toBeUndefined()
    // Order preserved: a comes before c → lower pinOrder.
    expect((byId.get('a')!.pinOrder ?? -1) < (byId.get('c')!.pinOrder ?? -1)).toBe(true)
  })

  it('drops every non-priority folderId without pinning', () => {
    const data: PersistedState = {
      projects: [
        { id: 'p1', name: 'p1', repoPath: '/tmp/p1', priorityFolderId: 'p1-prio' } as PersistedState['projects'][number],
      ],
      workspaces: [ws('b', 'p1', 'p1-default')],
      folders: [
        { id: 'p1-prio', projectId: 'p1', name: 'Priority', order: 0 },
        { id: 'p1-default', projectId: 'p1', name: 'Non-Priority', order: 1 },
      ],
    }

    const [migrated] = migrateFoldersToOverrides(data, data.workspaces)
    expect(migrated.pinned).toBeUndefined()
    expect('folderId' in (migrated as LegacyWorkspace)).toBe(false)
  })

  it('keeps per-project pinned ordering independent', () => {
    const data: PersistedState = {
      projects: [
        { id: 'p1', name: 'p1', repoPath: '/tmp/p1', priorityFolderId: 'p1-prio' } as PersistedState['projects'][number],
        { id: 'p2', name: 'p2', repoPath: '/tmp/p2', priorityFolderId: 'p2-prio' } as PersistedState['projects'][number],
      ],
      workspaces: [ws('a', 'p1', 'p1-prio'), ws('x', 'p2', 'p2-prio')],
      folders: [
        { id: 'p1-prio', projectId: 'p1', name: 'Priority', order: 0 },
        { id: 'p2-prio', projectId: 'p2', name: 'Priority', order: 0 },
      ],
    }
    const result = migrateFoldersToOverrides(data, data.workspaces)
    expect(result.every((w) => w.pinned)).toBe(true)
  })

  it('is idempotent: no folders key is a no-op (only strips residual folderId)', () => {
    const alreadyMigrated: Workspace[] = [
      { id: 'a', name: 'a', branch: 'a', worktreePath: '/tmp/a', projectId: 'p1', pinned: true, pinOrder: 0 },
      { id: 'b', name: 'b', branch: 'b', worktreePath: '/tmp/b', projectId: 'p1' },
    ]
    const data: PersistedState = {
      projects: [{ id: 'p1', name: 'p1', repoPath: '/tmp/p1' }],
      workspaces: alreadyMigrated,
      // no `folders` key — migration already ran.
    }
    const result = migrateFoldersToOverrides(data, alreadyMigrated)
    expect(result[0]!.pinned).toBe(true)
    expect(result[0]!.pinOrder).toBe(0)
    expect(result[1]!.pinned).toBeUndefined()
  })

  it('stripWorkspaceFolderId removes folderId but preserves other fields', () => {
    const stripped = stripWorkspaceFolderId(ws('a', 'p1', 'p1-prio'))
    expect('folderId' in (stripped as LegacyWorkspace)).toBe(false)
    expect(stripped.id).toBe('a')
    expect(stripped.projectId).toBe('p1')
  })
})
