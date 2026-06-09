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

describe('hydrateState git graph removal migration', () => {
  it('strips legacy commitHash and commitMessage from diff tabs', async () => {
    const { useAppStore } = await loadStore()

    useAppStore.getState().hydrateState({
      projects: [project],
      workspaces: [workspace],
      tabs: [
        {
          id: 'diff-legacy',
          workspaceId: workspace.id,
          type: 'diff',
          commitHash: 'abc123def456',
          commitMessage: 'feat: old commit diff',
        } as never,
        {
          id: 'term-1',
          workspaceId: workspace.id,
          type: 'terminal',
          title: 'Terminal',
          ptyId: 'pty-1',
        },
      ],
      activeTabId: 'diff-legacy',
    })

    const state = useAppStore.getState()
    const diffTab = state.tabs.find((tab) => tab.id === 'diff-legacy')
    expect(diffTab).toEqual({
      id: 'diff-legacy',
      workspaceId: workspace.id,
      type: 'diff',
    })
    expect(state.activeTabId).toBe('diff-legacy')
  })

  it('normalizes sidePanels that still reference the removed graph panel', async () => {
    const { useAppStore } = await loadStore()

    useAppStore.getState().hydrateState({
      projects: [project],
      workspaces: [workspace],
      tabs: [],
      rightPanelMode: 'graph',
      sidePanels: {
        left: { open: true, activePanel: 'project', panelOrder: ['project'] },
        right: {
          open: true,
          activePanel: 'graph',
          panelOrder: ['files', 'changes', 'graph', 'browser', 'sideChat'],
        },
      },
    })

    const { sidePanels } = useAppStore.getState()
    expect(sidePanels.right.panelOrder).toEqual(['files', 'changes', 'browser', 'sideChat'])
    expect(sidePanels.right.activePanel).toBe('files')
  })

  it('does not expose openCommitDiffTab on the store', async () => {
    const { useAppStore } = await loadStore()
    expect('openCommitDiffTab' in useAppStore.getState()).toBe(false)
  })
})
