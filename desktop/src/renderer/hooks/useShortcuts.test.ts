import { describe, expect, it } from 'bun:test'
import {
  getShortcutWorkspace,
  isWorkspaceDeleteShortcut,
  showDeleteWorkspaceConfirmation,
} from './workspace-delete-shortcut'
import type { ConfirmDialogState, Workspace } from '../store/types'

const workspace: Workspace = {
  id: 'ws-1',
  name: 'feature-delete',
  branch: 'feature-delete',
  projectId: 'project-1',
  worktreePath: '/repo/.worktrees/feature-delete',
}

describe('workspace delete shortcut helpers', () => {
  it('recognizes Cmd+Backspace and Cmd+Delete only', () => {
    expect(isWorkspaceDeleteShortcut({
      key: 'Backspace',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    })).toBe(true)
    expect(isWorkspaceDeleteShortcut({
      key: 'Delete',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    })).toBe(true)
    expect(isWorkspaceDeleteShortcut({
      key: 'Backspace',
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    })).toBe(false)
  })

  it('resolves the active workspace selected by the app state', () => {
    expect(getShortcutWorkspace({
      activeWorkspaceId: workspace.id,
      workspaces: [workspace],
    })).toEqual(workspace)
    expect(getShortcutWorkspace({
      activeWorkspaceId: 'missing',
      workspaces: [workspace],
    })).toBeNull()
  })

  it('shows an exit-first destructive confirmation and deletes once confirmed', async () => {
    let dialog: ConfirmDialogState | null = null
    const calls: string[] = []

    showDeleteWorkspaceConfirmation({
      activeWorkspaceId: workspace.id,
      workspaces: [workspace],
      showConfirmDialog: (next) => {
        dialog = next
      },
      deleteWorkspace: async (workspaceId) => {
        calls.push(`delete:${workspaceId}`)
      },
    }, workspace)

    expect(dialog?.title).toBe('Delete Workspace')
    expect(dialog?.confirmInPlace).toBeUndefined()
    expect(dialog?.destructive).toBe(true)

    dialog?.onConfirm()
    await Promise.resolve()

    expect(calls).toEqual(['delete:ws-1'])
  })
})
