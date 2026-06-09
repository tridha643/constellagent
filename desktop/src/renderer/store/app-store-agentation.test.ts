import { beforeEach, describe, expect, it } from 'bun:test'
import type { AgentationSession } from '../../shared/agentation-types'

type MockWindow = typeof globalThis & {
  api: {
    automations: { emitWorkspaceEvent: (event: unknown) => void }
    pty: { destroy: (id: string) => void; write: (id: string, data: string) => void }
    state: { save: () => void; saveSync: () => void; load: () => Promise<unknown> }
  }
  addEventListener: () => void
  removeEventListener: () => void
}

let ptyWrites: Array<{ id: string; data: string }> = []

function installWindowMock() {
  ptyWrites = []
  const mockWindow: MockWindow = {
    ...globalThis,
    api: {
      automations: { emitWorkspaceEvent: () => {} },
      pty: { destroy: () => {}, write: (id: string, data: string) => ptyWrites.push({ id, data }) },
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

beforeEach(() => {
  installWindowMock()
})

const session = (id: string, annotations: AgentationSession['annotations'] = []): AgentationSession => ({
  id,
  annotations,
})

describe('applyAgentationEvent reducer', () => {
  it('stores a forwarded status event', async () => {
    const { useAppStore } = await loadStore()
    useAppStore.getState().applyAgentationEvent({
      type: 'status',
      status: { connected: true, streaming: true, endpoint: 'http://localhost:4747' },
    })
    expect(useAppStore.getState().agentationStatus?.connected).toBe(true)
  })

  it('synthesizes a session for an annotation whose session is unknown', async () => {
    const { useAppStore } = await loadStore()
    useAppStore.getState().setAgentationSessions([])
    useAppStore.getState().applyAgentationEvent({
      type: 'annotation.created',
      annotation: { id: 'a1', comment: 'hi', sessionId: 's1' },
    })
    const sessions = useAppStore.getState().agentationSessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('s1')
    expect(sessions[0].annotations.map((a) => a.id)).toEqual(['a1'])
  })

  it('appends, patches, and deletes annotations within a session', async () => {
    const { useAppStore } = await loadStore()
    useAppStore.getState().setAgentationSessions([session('s1', [{ id: 'a1', comment: 'first', sessionId: 's1' }])])

    useAppStore.getState().applyAgentationEvent({
      type: 'annotation.created',
      annotation: { id: 'a2', comment: 'second', sessionId: 's1' },
    })
    expect(useAppStore.getState().agentationSessions[0].annotations).toHaveLength(2)

    useAppStore.getState().applyAgentationEvent({
      type: 'annotation.updated',
      annotation: { id: 'a1', comment: 'edited', sessionId: 's1' },
    })
    const a1 = useAppStore.getState().agentationSessions[0].annotations.find((a) => a.id === 'a1')
    expect(a1?.comment).toBe('edited')

    useAppStore.getState().applyAgentationEvent({ type: 'annotation.deleted', annotationId: 'a2' })
    expect(useAppStore.getState().agentationSessions[0].annotations.map((a) => a.id)).toEqual(['a1'])
  })

  it('adds a new session and ignores a duplicate session.created', async () => {
    const { useAppStore } = await loadStore()
    useAppStore.getState().setAgentationSessions([session('s1')])
    useAppStore.getState().applyAgentationEvent({ type: 'session.created', session: session('s2') })
    expect(useAppStore.getState().agentationSessions.map((s) => s.id)).toEqual(['s1', 's2'])

    useAppStore.getState().applyAgentationEvent({ type: 'session.created', session: session('s2') })
    expect(useAppStore.getState().agentationSessions.map((s) => s.id)).toEqual(['s1', 's2'])
  })
})

describe('pending composer draft', () => {
  it('stages then consumes a draft once', async () => {
    const { useAppStore } = await loadStore()
    useAppStore.getState().setPendingComposerDraft('tab-1', 'hello agent')
    expect(useAppStore.getState().consumePendingComposerDraft('tab-1')).toBe('hello agent')
    // Consumed — second read is empty and the key is cleared.
    expect(useAppStore.getState().consumePendingComposerDraft('tab-1')).toBe('')
    expect('tab-1' in useAppStore.getState().pendingComposerDraftByTab).toBe(false)
  })

  it('returns empty string for an unknown tab', async () => {
    const { useAppStore } = await loadStore()
    expect(useAppStore.getState().consumePendingComposerDraft('nope')).toBe('')
  })
})

describe('createBrowserTabForActiveWorkspace', () => {
  it('creates a browser tab and closes overlay panels', async () => {
    const { useAppStore } = await loadStore()
    useAppStore.getState().hydrateState({
      projects: [{ id: 'p1', name: 'P', repoPath: '/tmp/p' }],
      workspaces: [{ id: 'w1', name: 'W', branch: 'main', worktreePath: '/tmp/p', projectId: 'p1' }],
      activeWorkspaceId: 'w1',
    })
    useAppStore.setState({ settingsOpen: true, automationsOpen: true, linearPanelOpen: true })
    useAppStore.getState().createBrowserTabForActiveWorkspace()
    const s = useAppStore.getState()
    expect(s.tabs.some((t) => t.type === 'browser')).toBe(true)
    expect(s.settingsOpen).toBe(false)
    expect(s.automationsOpen).toBe(false)
    expect(s.linearPanelOpen).toBe(false)
  })

  it('creates incrementing browser tab titles', async () => {
    const { useAppStore } = await loadStore()
    useAppStore.getState().hydrateState({
      projects: [{ id: 'p1', name: 'P', repoPath: '/tmp/p' }],
      workspaces: [{ id: 'w1', name: 'W', branch: 'main', worktreePath: '/tmp/p', projectId: 'p1' }],
      activeWorkspaceId: 'w1',
    })
    useAppStore.getState().createBrowserTabForActiveWorkspace()
    useAppStore.getState().createBrowserTabForActiveWorkspace()
    const titles = useAppStore
      .getState()
      .tabs.filter((t) => t.type === 'browser')
      .map((t) => t.title)
    expect(titles).toEqual(['Browser', 'Browser 2'])
  })
})

describe('sendAgentationAnnotation routing', () => {
  it('with no agent terminal and no workspace, surfaces a toast and does not throw', async () => {
    const { useAppStore } = await loadStore()
    useAppStore.getState().hydrateState({ projects: [], workspaces: [], tabs: [] })
    const before = useAppStore.getState().toasts.length
    useAppStore.getState().sendAgentationAnnotation('**Feedback**\n\nfix this')
    expect(ptyWrites).toHaveLength(0)
    expect(useAppStore.getState().toasts.length).toBe(before + 1)
  })
})
