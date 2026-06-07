import { beforeEach, describe, expect, it } from 'bun:test'
import type { AppState, Project, Workspace } from './types'

type MockWindow = typeof globalThis & {
  api: {
    automations: { emitWorkspaceEvent: (event: unknown) => void }
    git: {
      removeWorktree: (repoPath: string, worktreePath: string) => Promise<void>
      setSyncBusy: (paths: string[]) => void
    }
    pty: { destroy: (id: string) => void }
    spotlight: { disable: (projectId: string) => Promise<void> }
    state: {
      save: (state: unknown) => void
      saveSync: (state: unknown) => void
      load: () => Promise<unknown>
    }
  }
  addEventListener: () => void
  removeEventListener: () => void
}

const project: Project = {
  id: 'project-1',
  name: 'Project',
  repoPath: '/repo',
}

const workspace: Workspace = {
  id: 'ws-1',
  name: 'feature-delete',
  branch: 'feature-delete',
  projectId: project.id,
  worktreePath: '/repo/.worktrees/feature-delete',
}

let removeWorktreeCalls: Array<[string, string]> = []
let destroyedPtys: string[] = []
let emittedEvents: unknown[] = []
let failRemoveWorktree = false

function installWindowMock() {
  const mockWindow: MockWindow = {
    ...globalThis,
    api: {
      automations: {
        emitWorkspaceEvent: (event: unknown) => {
          emittedEvents.push(event)
        },
      },
      git: {
        removeWorktree: async (repoPath: string, worktreePath: string) => {
          removeWorktreeCalls.push([repoPath, worktreePath])
          if (failRemoveWorktree) throw new Error('remove failed')
        },
        setSyncBusy: () => {},
      },
      pty: {
        destroy: (id: string) => {
          destroyedPtys.push(id)
        },
      },
      spotlight: {
        disable: async () => {},
      },
      state: {
        save: () => {},
        saveSync: () => {},
        load: async () => null,
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  ;(globalThis as typeof globalThis & { window: MockWindow }).window = mockWindow
}

async function loadStore() {
  installWindowMock()
  return await import('./app-store')
}

function seedDeleteState(useAppStore: { setState: (partial: Partial<AppState>) => void }) {
  useAppStore.setState({
    projects: [project],
    workspaces: [workspace],
    tabs: [
      {
        id: 'tab-1',
        workspaceId: workspace.id,
        type: 'terminal',
        title: 'Terminal',
        ptyId: 'pty-1',
      },
    ],
    activeWorkspaceId: workspace.id,
    activeTabId: 'tab-1',
    toasts: [],
    unreadWorkspaceIds: new Set([workspace.id]),
    activeClaudeWorkspaceIds: new Set([workspace.id]),
    worktreeSyncStatus: new Map([[workspace.id, { state: 'idle' }]]),
    graphiteStacks: new Map(),
    spotlightWorkspaceIdByProject: {},
    lastActiveWorkspaceByProjectId: { [project.id]: workspace.id },
    lastActiveTabByWorkspace: { [workspace.id]: 'tab-1' },
    planBuildTerminalByPlanPath: {},
  })
}

beforeEach(() => {
  removeWorktreeCalls = []
  destroyedPtys = []
  emittedEvents = []
  failRemoveWorktree = false
})

describe('deleteWorkspace', () => {
  it('removes the renderer workspace only after git worktree removal succeeds', async () => {
    const { useAppStore } = await loadStore()
    seedDeleteState(useAppStore)

    await useAppStore.getState().deleteWorkspace(workspace.id)

    expect(removeWorktreeCalls).toEqual([[project.repoPath, workspace.worktreePath]])
    expect(useAppStore.getState().workspaces).toEqual([])
    expect(useAppStore.getState().tabs).toEqual([])
    expect(useAppStore.getState().activeWorkspaceId).toBeNull()
    expect(destroyedPtys).toEqual(['pty-1'])
    expect(emittedEvents).toHaveLength(1)
  })

  it('keeps the workspace visible and reports an error when git removal fails', async () => {
    const { useAppStore } = await loadStore()
    seedDeleteState(useAppStore)
    failRemoveWorktree = true

    await useAppStore.getState().deleteWorkspace(workspace.id)

    expect(removeWorktreeCalls).toEqual([[project.repoPath, workspace.worktreePath]])
    expect(useAppStore.getState().workspaces.map((entry) => entry.id)).toEqual([workspace.id])
    expect(useAppStore.getState().tabs.map((entry) => entry.id)).toEqual(['tab-1'])
    expect(destroyedPtys).toEqual([])
    expect(useAppStore.getState().toasts.at(-1)?.message).toBe('remove failed')
  })
})
