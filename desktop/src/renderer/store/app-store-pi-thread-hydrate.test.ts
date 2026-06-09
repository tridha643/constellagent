import { beforeEach, describe, expect, it } from 'bun:test'
import type { Project, Workspace } from './types'

type MockWindow = typeof globalThis & {
  api: {
    automations: { emitWorkspaceEvent: (event: unknown) => void }
    git: {
      removeWorktree: (repoPath: string, worktreePath: string) => Promise<void>
      listWorktrees: (repoPath: string) => Promise<Array<{ path: string }>>
      checkIsRepo: (dirPath: string) => Promise<boolean>
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
  name: 'feature',
  branch: 'feature',
  projectId: project.id,
  worktreePath: '/repo/.worktrees/feature',
}

function installWindowMock() {
  const mockWindow: MockWindow = {
    ...globalThis,
    api: {
      automations: { emitWorkspaceEvent: () => {} },
      git: {
        removeWorktree: async () => {},
        listWorktrees: async () => [],
        checkIsRepo: async () => false,
        setSyncBusy: () => {},
      },
      pty: { destroy: () => {} },
      spotlight: { disable: async () => {} },
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

beforeEach(() => {
  installWindowMock()
})

describe('hydrateState pi-thread migration', () => {
  it('strips legacy pi-thread tabs and clears invalid activeTabId', async () => {
    const { useAppStore } = await loadStore()

    useAppStore.getState().hydrateState({
      projects: [project],
      workspaces: [workspace],
      tabs: [
        {
          id: 'pi-tab-1',
          workspaceId: workspace.id,
          type: 'pi-thread',
          title: 'PI Chat',
          piSessionId: 'sess-old',
          piSessionTitle: 'Old Pi',
        } as never,
        {
          id: 'term-1',
          workspaceId: workspace.id,
          type: 'terminal',
          title: 'Terminal',
          ptyId: 'pty-1',
        },
      ],
      activeTabId: 'pi-tab-1',
      lastActiveTabByWorkspace: {
        [workspace.id]: 'pi-tab-1',
      },
    })

    const state = useAppStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['term-1'])
    expect(state.tabs.some((t) => (t as { type?: string }).type === 'pi-thread')).toBe(false)
    expect(state.activeTabId).toBeNull()
    expect(state.lastActiveTabByWorkspace[workspace.id]).toBeUndefined()
  })

  it('does not expose createPiThreadForActiveWorkspace on the store', async () => {
    const { useAppStore } = await loadStore()
    expect(
      'createPiThreadForActiveWorkspace' in useAppStore.getState(),
    ).toBe(false)
  })
})
