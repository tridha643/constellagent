import { describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

mock.module('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'constellagent-router-test-userdata'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

const routerModule = await import('./mobile-method-router')
const { createMobileMethodRouter, __testing } = routerModule
type MobileRouterDeps = import('./mobile-method-router').MobileRouterDeps

// Minimal in-memory doubles for the services the router wraps. We only stub
// the methods the router actually calls — anything else will fail loudly.

function makeFakeHost(): MobileRouterDeps['agentChatHost'] {
  const sessions = new Map<string, { state: { sessionId: string; workspaceId: string; title: string } }>()
  const submitted: Array<{ sessionId: string; text: string; deliverAs?: string }> = []
  const cancelled: string[] = []
  const planToggles: Array<{ sessionId: string; plan: boolean }> = []
  const fake = {
    async listSessions(workspaceId: string) {
      return Array.from(sessions.values()).filter((s) => s.state.workspaceId === workspaceId).map((s) => s.state)
    },
    async createSession(input: { workspaceId: string; workspacePath: string; provider: string; model: string; title?: string }) {
      const state = { sessionId: `sess_${sessions.size + 1}`, workspaceId: input.workspaceId, title: input.title ?? 'New chat' }
      sessions.set(state.sessionId, { state })
      return state
    },
    async submit(sessionId: string, text: string, deliverAs?: string) {
      submitted.push({ sessionId, text, ...(deliverAs ? { deliverAs } : {}) })
    },
    async cancel(sessionId: string) {
      cancelled.push(sessionId)
    },
    async getSession(sessionId: string) {
      const found = sessions.get(sessionId)
      if (!found) return null
      return { state: found.state, transcript: [] }
    },
    async setPlan(sessionId: string, plan: boolean) {
      planToggles.push({ sessionId, plan })
    },
    async listPiModels(_workspacePath: string) {
      return [
        { cliModel: 'claude-sonnet-4', label: 'Sonnet 4' },
        { cliModel: 'claude-opus-4', label: 'Opus 4' },
      ]
    },
    // Inspection hooks used by assertions
    __submitted: submitted,
    __cancelled: cancelled,
    __planToggles: planToggles,
  }
  return fake as unknown as MobileRouterDeps['agentChatHost']
}

function makeFakeGit() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const fake = {
    async getStatus(...args: unknown[]) { calls.push({ method: 'getStatus', args }); return [] },
    async getCurrentBranch(...args: unknown[]) { calls.push({ method: 'getCurrentBranch', args }); return 'main' },
    async getBranches(...args: unknown[]) { calls.push({ method: 'getBranches', args }); return ['main', 'dev'] },
    async checkoutBranch(...args: unknown[]) { calls.push({ method: 'checkoutBranch', args }) },
    async commit(...args: unknown[]) { calls.push({ method: 'commit', args }) },
    async getDiff(...args: unknown[]) { calls.push({ method: 'getDiff', args }); return [] },
    async getFileDiff(...args: unknown[]) { calls.push({ method: 'getFileDiff', args }); return '' },
    __calls: calls,
  }
  return fake as unknown as MobileRouterDeps['gitService']
}

function makeFakeAnnotations() {
  const created: Array<unknown> = []
  const fake = {
    async listComments() { return [] },
    async addComment(...args: unknown[]) { created.push(args) },
    async setResolved() {},
    __created: created,
  }
  return fake as unknown as MobileRouterDeps['annotationService']
}

function makeDeps() {
  return {
    agentChatHost: makeFakeHost(),
    gitService: makeFakeGit(),
    annotationService: makeFakeAnnotations(),
    listMobileWorkspaces: () =>
      [
        {
          id: 'ws-1',
          name: 'demo',
          worktreePath: '/tmp/ws',
          updatedAt: new Date().toISOString(),
        },
      ] as never,
  } satisfies MobileRouterDeps
}

describe('mobile method router', () => {
  test('workspace.list returns the persisted mobile workspaces', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    const response = await router.dispatch({
      kind: 'rpcRequest',
      id: '1',
      method: 'workspace.list',
      params: {},
    })
    expect(response.error).toBeUndefined()
    const result = response.result as { workspaces: unknown[] }
    expect(result.workspaces.length).toBe(1)
  })

  test('session.start + session.list round-trip via the fake host', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    const startResp = await router.dispatch({
      kind: 'rpcRequest',
      id: '2',
      method: 'session.start',
      params: { workspaceId: 'ws-1', workspacePath: '/tmp/ws', provider: 'pi', model: 'opus' },
    })
    expect(startResp.error).toBeUndefined()
    const listResp = await router.dispatch({
      kind: 'rpcRequest',
      id: '3',
      method: 'session.list',
      params: { workspaceId: 'ws-1' },
    })
    const list = listResp.result as { sessions: Array<{ sessionId: string }> }
    expect(list.sessions.length).toBe(1)
  })

  test('session.resume returns an existing session without creating a new one', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    const startResp = await router.dispatch({
      kind: 'rpcRequest',
      id: 'start-1',
      method: 'session.start',
      params: { workspaceId: 'ws-1', workspacePath: '/tmp/ws', provider: 'pi', model: 'opus' },
    })
    const created = (startResp.result as { session: { sessionId: string } }).session
    const resumeResp = await router.dispatch({
      kind: 'rpcRequest',
      id: 'resume-1',
      method: 'session.resume',
      params: { sessionId: created.sessionId, excludeTurns: true },
    })
    expect(resumeResp.error).toBeUndefined()
    const resumed = (resumeResp.result as { session: { sessionId: string } }).session
    expect(resumed.sessionId).toBe(created.sessionId)
    const listResp = await router.dispatch({
      kind: 'rpcRequest',
      id: 'list-1',
      method: 'session.list',
      params: { workspaceId: 'ws-1' },
    })
    const list = listResp.result as { sessions: unknown[] }
    expect(list.sessions.length).toBe(1)
  })

  test('plan.approve forwards the canonical approval message to host.submit', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    const r = await router.dispatch({
      kind: 'rpcRequest',
      id: '4',
      method: 'plan.approve',
      params: { sessionId: 'sess_1' },
    })
    expect(r.error).toBeUndefined()
    const submitted = (deps.agentChatHost as unknown as { __submitted: Array<{ text: string }> }).__submitted
    expect(submitted[0]?.text).toContain('Approved')
  })

  test('invalid params produce a structured invalid_params error', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    const r = await router.dispatch({
      kind: 'rpcRequest',
      id: '5',
      method: 'session.reply',
      params: { sessionId: '', text: '' },
    })
    expect(r.error?.code).toBe('invalid_params')
  })

  test('handleApplicationMessage returns parse_error on garbage input', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    const r = await router.handleApplicationMessage('not json')
    expect(r?.error?.code).toBe('parse_error')
  })

  test('handleApplicationMessage ignores non-request payloads', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    const r = await router.handleApplicationMessage(JSON.stringify({ kind: 'rpcResponse', id: 'x' }))
    expect(r).toBeNull()
  })

  test('workspace.read enforces the path-outside-workspace boundary', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'router-ws-'))
    try {
      mkdirSync(join(tempRoot, 'sub'))
      writeFileSync(join(tempRoot, 'sub', 'hello.txt'), 'world')
      const deps = makeDeps()
      const router = createMobileMethodRouter(deps)
      const good = await router.dispatch({
        kind: 'rpcRequest',
        id: '6',
        method: 'workspace.read',
        params: { workspacePath: tempRoot, relativePath: 'sub/hello.txt' },
      })
      expect((good.result as { contents: string }).contents).toBe('world')
      const traversal = await router.dispatch({
        kind: 'rpcRequest',
        id: '7',
        method: 'workspace.read',
        params: { workspacePath: tempRoot, relativePath: '../escape.txt' },
      })
      expect(traversal.error?.code).toBe('path_outside_workspace')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('model.list maps Pi presets to codex items', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    const response = await router.dispatch({
      kind: 'rpcRequest',
      id: '8',
      method: 'model.list',
      params: { workspacePath: '/tmp/ws' },
    })
    expect(response.error).toBeUndefined()
    const items = (response.result as { items: Array<{ id: string; isDefault?: boolean }> }).items
    expect(items.length).toBe(2)
    expect(items[0]?.id).toBe('claude-sonnet-4')
    expect(items[0]?.isDefault).toBe(true)
  })

  test('session.list listAll aggregates sessions across workspaces', async () => {
    const deps = makeDeps()
    const router = createMobileMethodRouter(deps)
    await router.dispatch({
      kind: 'rpcRequest',
      id: '9a',
      method: 'session.start',
      params: { workspaceId: 'ws-1', workspacePath: '/tmp/ws', provider: 'pi', model: 'opus' },
    })
    const listResp = await router.dispatch({
      kind: 'rpcRequest',
      id: '9b',
      method: 'session.list',
      params: { listAll: true, workspaceIds: ['ws-1'] },
    })
    const list = listResp.result as { sessions: unknown[] }
    expect(list.sessions.length).toBe(1)
  })

  test('normalizeError preserves RpcError code/message and wraps unknown errors', () => {
    const wrapped = __testing.normalizeError(new __testing.RpcError('foo', 'bar', { hint: 1 }))
    expect(wrapped).toEqual({ code: 'foo', message: 'bar', data: { hint: 1 } })
    const generic = __testing.normalizeError(new Error('boom'))
    expect(generic?.code).toBe('internal_error')
  })

  test('session.reply notifies onSessionSubmitFailed when submit rejects', async () => {
    const deps = makeDeps()
    const host = deps.agentChatHost as unknown as {
      getSession: (sessionId: string) => Promise<{ state: { sessionId: string; runPhase: string } } | null>
      submit: (sessionId: string, text: string) => Promise<void>
    }
    host.getSession = async (sessionId: string) => ({
      state: { sessionId, runPhase: 'idle' },
    })
    host.submit = async () => {
      throw new Error('submit boom')
    }

    const failures: Array<{ sessionId: string; error: string }> = []
    const router = createMobileMethodRouter({
      ...deps,
      onSessionSubmitFailed: (payload) => {
        failures.push(payload)
      },
    })

    const response = await router.dispatch({
      kind: 'rpcRequest',
      id: 'reply-fail',
      method: 'session.reply',
      params: { sessionId: 'sess_1', text: 'hello' },
    })

    expect(response.error).toBeUndefined()
    expect((response.result as { ok: boolean }).ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(failures).toEqual([{ sessionId: 'sess_1', error: 'submit boom' }])
  })

  test('session.reply returns before submit settles', async () => {
    let resolveSubmit: (() => void) | undefined
    const submitGate = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const deps = makeDeps()
    const host = deps.agentChatHost as unknown as {
      __submitted: Array<{ sessionId: string; text: string }>
      getSession: (sessionId: string) => Promise<{ state: { sessionId: string; runPhase: string } } | null>
      submit: (sessionId: string, text: string) => Promise<void>
    }
    host.getSession = async (sessionId: string) => ({
      state: { sessionId, runPhase: 'idle' },
    })
    host.submit = async (sessionId: string, text: string) => {
      await submitGate
      host.__submitted.push({ sessionId, text })
    }

    const router = createMobileMethodRouter(deps)
    const responsePromise = router.dispatch({
      kind: 'rpcRequest',
      id: 'reply-fast',
      method: 'session.reply',
      params: { sessionId: 'sess_1', text: 'hello' },
    })

    const response = await responsePromise
    expect(response.error).toBeUndefined()
    expect((response.result as { ok: boolean }).ok).toBe(true)
    expect(host.__submitted.length).toBe(0)

    resolveSubmit?.()
    await submitGate
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(host.__submitted.length).toBe(1)
  })
})
