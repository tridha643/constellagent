import { beforeEach, describe, expect, it } from 'bun:test'
import type { AppState, Project, SideTerminalSession, Workspace } from './types'
import type { TerminalSessionSummary } from '../../shared/terminal-session-types'

type MockWindow = typeof globalThis & {
  api: {
    pty: { destroy: (id: string) => void }
    terminalSession: {
      list: (workspaceId?: string) => Promise<TerminalSessionSummary[]>
      kill: (sessionName: string) => Promise<{ ok: boolean }>
    }
    state: { save: () => void; saveSync: () => void; load: () => Promise<unknown> }
  }
  addEventListener: () => void
  removeEventListener: () => void
}

const project: Project = { id: 'project-1', name: 'Project', repoPath: '/repo' }
const workspace: Workspace = {
  id: 'ws-1',
  name: 'feature',
  branch: 'feature',
  projectId: project.id,
  worktreePath: '/repo/.worktrees/feature',
}

let destroyedPtys: string[] = []
let killedSessions: string[] = []
let listResult: TerminalSessionSummary[] = []
let listThrows = false

function installWindowMock() {
  const mockWindow: MockWindow = {
    ...globalThis,
    api: {
      pty: { destroy: (id: string) => { destroyedPtys.push(id) } },
      terminalSession: {
        list: async () => {
          if (listThrows) throw new Error('tmux hiccup')
          return listResult
        },
        kill: async (sessionName: string) => {
          killedSessions.push(sessionName)
          return { ok: true }
        },
      },
      state: { save: () => {}, saveSync: () => {}, load: async () => null },
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

function tmuxSession(over: Partial<SideTerminalSession>): SideTerminalSession {
  return {
    id: 'term-x',
    workspaceId: workspace.id,
    backend: 'tmux',
    sessionName: 'ca-ws_1-term_x',
    title: 'Terminal',
    status: 'detached',
    createdAt: 1,
    ...over,
  }
}

function seed(useAppStore: { setState: (partial: Partial<AppState>) => void }, sessions: SideTerminalSession[]) {
  useAppStore.setState({
    projects: [project],
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    sideTerminalsByWorkspace: { [workspace.id]: sessions },
    toasts: [],
  })
}

beforeEach(() => {
  destroyedPtys = []
  killedSessions = []
  listResult = []
  listThrows = false
})

describe('reconcileSideTerminalsForWorkspace', () => {
  it('prunes a tmux session that is no longer alive and destroys its client PTY', async () => {
    const { useAppStore } = await loadStore()
    seed(useAppStore, [tmuxSession({ id: 'dead', sessionName: 'ca-ws_1-dead', clientPtyId: 'pty-dead', createdAt: 1 })])
    listResult = [] // tmux reports no sessions

    await useAppStore.getState().reconcileSideTerminalsForWorkspace(workspace.id)

    expect(useAppStore.getState().sideTerminalsByWorkspace[workspace.id]).toEqual([])
    expect(destroyedPtys).toEqual(['pty-dead'])
  })

  it('does not resurrect a closed session and does not prune a freshly-created one', async () => {
    const { useAppStore } = await loadStore()
    seed(useAppStore, [
      tmuxSession({ id: 'fresh', sessionName: 'ca-ws_1-fresh', createdAt: Number.MAX_SAFE_INTEGER }),
    ])
    listResult = [] // snapshot predates the fresh session

    await useAppStore.getState().reconcileSideTerminalsForWorkspace(workspace.id)

    const ids = useAppStore.getState().sideTerminalsByWorkspace[workspace.id].map((s) => s.id)
    expect(ids).toEqual(['fresh'])
  })

  it('keeps local (non-tmux) sessions even when the tmux list is empty', async () => {
    const { useAppStore } = await loadStore()
    seed(useAppStore, [tmuxSession({ id: 'local', backend: 'local', sessionName: undefined, createdAt: 1 })])
    listResult = []

    await useAppStore.getState().reconcileSideTerminalsForWorkspace(workspace.id)

    const ids = useAppStore.getState().sideTerminalsByWorkspace[workspace.id].map((s) => s.id)
    expect(ids).toEqual(['local'])
  })

  it('adopts a tmux session discovered out-of-band', async () => {
    const { useAppStore } = await loadStore()
    seed(useAppStore, [])
    listResult = [
      { backend: 'tmux', sessionName: 'ca-ws_1-found', workspaceId: workspace.id, terminalId: 'found', createdAt: 100 },
    ]

    await useAppStore.getState().reconcileSideTerminalsForWorkspace(workspace.id)

    const sessions = useAppStore.getState().sideTerminalsByWorkspace[workspace.id]
    expect(sessions.map((s) => s.id)).toEqual(['found'])
    expect(sessions[0].backend).toBe('tmux')
  })

  it('leaves state untouched when the tmux list call throws', async () => {
    const { useAppStore } = await loadStore()
    const existing = tmuxSession({ id: 'keep', sessionName: 'ca-ws_1-keep', createdAt: 1 })
    seed(useAppStore, [existing])
    listThrows = true

    await useAppStore.getState().reconcileSideTerminalsForWorkspace(workspace.id)

    expect(useAppStore.getState().sideTerminalsByWorkspace[workspace.id].map((s) => s.id)).toEqual(['keep'])
    expect(destroyedPtys).toEqual([])
  })
})

describe('killSideTerminalSession', () => {
  it('removes the session immediately and kills the tmux session', async () => {
    const { useAppStore } = await loadStore()
    seed(useAppStore, [tmuxSession({ id: 'gone', sessionName: 'ca-ws_1-gone', clientPtyId: 'pty-gone' })])

    await useAppStore.getState().killSideTerminalSession(workspace.id, 'gone')

    expect(useAppStore.getState().sideTerminalsByWorkspace[workspace.id]).toEqual([])
    expect(destroyedPtys).toEqual(['pty-gone'])
    expect(killedSessions).toEqual(['ca-ws_1-gone'])
  })
})
