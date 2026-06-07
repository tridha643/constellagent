import type { AppState, Workspace } from '../store/types'

type WorkspaceDeleteShortcutStore = Pick<
  AppState,
  | 'activeWorkspaceId'
  | 'workspaces'
  | 'showConfirmDialog'
  | 'updateConfirmDialog'
  | 'dismissConfirmDialog'
  | 'deleteWorkspace'
>

export function isWorkspaceDeleteShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  return e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'Backspace' || e.key === 'Delete')
}

export function getShortcutWorkspace(store: Pick<AppState, 'activeWorkspaceId' | 'workspaces'>): Workspace | null {
  return store.workspaces.find((workspace) => workspace.id === store.activeWorkspaceId) ?? null
}

export function showDeleteWorkspaceConfirmation(store: WorkspaceDeleteShortcutStore, workspace: Workspace): void {
  store.showConfirmDialog({
    title: 'Delete Workspace',
    message: `Delete workspace "${workspace.name}"? This will remove the git worktree from disk.`,
    confirmLabel: 'Delete',
    destructive: true,
    confirmInPlace: true,
    onConfirm: () => {
      store.updateConfirmDialog({ loading: true })
      void store.deleteWorkspace(workspace.id)
        .then(
          () => store.dismissConfirmDialog(),
          () => store.updateConfirmDialog({ loading: false }),
        )
    },
  })
}
