import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentDriver } from './agents/agent-driver'
import type { AgentTurnContext } from './agents/agent-driver'
import type { AgentProvider } from '../shared/agent-chat-types'

let tempUserData = ''

mock.module('electron', () => ({
  app: {
    getPath: () => tempUserData,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

const { AgentChatHost } = await import('./agent-chat-host')

function createMockDriver(provider: AgentProvider, runTurn: AgentDriver['runTurn']): AgentDriver {
  return {
    provider,
    checkAuth: () => null,
    runTurn,
    closeSession: () => {},
  }
}

describe('AgentChatHost queue drain', () => {
  beforeEach(() => {
    tempUserData = mkdtempSync(join(tmpdir(), 'constellagent-chat-host-'))
  })

  afterEach(() => {
    try {
      rmSync(tempUserData, { recursive: true, force: true })
    } catch {}
  })

  test('drains the next follow-up after a turn completes', async () => {
    const host = new AgentChatHost()
    const runTexts: string[] = []
    let resolveFirst: (() => void) | undefined
    const firstTurn = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })

    ;(host as unknown as { drivers: Record<AgentProvider, AgentDriver> }).drivers = {
      codex: createMockDriver('codex', async (ctx: AgentTurnContext) => {
        runTexts.push(ctx.text)
        if (ctx.text === 'first') {
          await firstTurn
          return
        }
      }),
      cursor: createMockDriver('cursor', async () => {}),
    }

    const created = await host.createSession({
      workspaceId: 'ws-1',
      workspacePath: '/tmp/ws',
      provider: 'codex',
      model: 'gpt-5-codex',
    })

    const first = host.submit(created.sessionId, 'first')
    await Promise.resolve()
    await host.submit(created.sessionId, 'queued follow-up')
    resolveFirst?.()
    await first

    let last: { runs: string[]; queue: string[]; status: string | undefined } | null = null
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const session = await host.getSession(created.sessionId)
      last = {
        runs: [...runTexts],
        queue: session?.state.queuedMessages.map((item) => item.text) ?? [],
        status: session?.state.status,
      }
      if (last.runs.length === 2 && last.queue.length === 0 && last.status === 'idle') break
      await Bun.sleep(20)
    }

    expect(last).toEqual({
      runs: ['first', 'queued follow-up'],
      queue: [],
      status: 'idle',
    })
  })
})
