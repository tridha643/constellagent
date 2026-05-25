import { describe, expect, test } from 'bun:test'
import { IPC } from '@shared/ipc-channels'
import { createMobileEventBridge, type MobileEventBridgeOptions } from './mobile-event-bridge'

function makeHarness() {
  let listener: Parameters<MobileEventBridgeOptions['agentChatHost']['subscribeBroadcasts']>[0] | null = null
  const published: Array<Record<string, unknown>> = []
  const agentChatHost = {
    subscribeBroadcasts(next: NonNullable<typeof listener>) {
      listener = next
      return () => {
        listener = null
      }
    },
  } as unknown as MobileEventBridgeOptions['agentChatHost']
  const mobileServer = {
    async publishEvent(input: Record<string, unknown>) {
      published.push(input)
      return {
        id: published.length,
        type: input.type,
        payload: input.payload ?? {},
        createdAt: new Date().toISOString(),
      }
    },
  } as unknown as MobileEventBridgeOptions['mobileServer']
  createMobileEventBridge({ agentChatHost, mobileServer })
  if (!listener) throw new Error('listener was not registered')
  return { listener, published }
}

describe('mobile event bridge', () => {
  test('publishes awaiting-user state as session.needs_input for iOS prompt cards', () => {
    const { listener, published } = makeHarness()

    listener(IPC.AGENT_CHAT_STATE_CHANGED, {
      sessionId: 'sess_1',
      workspaceId: 'ws_1',
      status: 'running',
      runPhase: 'awaitingUser',
      blockingQuestion: {
        requestId: 'question-1',
        sessionId: 'sess_1',
        callId: 'call-1',
        provider: 'pi',
        source: 'askQuestion',
        createdAt: '2026-05-24T12:00:00.000Z',
        questions: [
          {
            header: 'Plan',
            question: 'Which path should I take?',
            options: [{ label: 'Safe path' }],
          },
        ],
      },
    })

    expect(published).toHaveLength(1)
    expect(published[0]?.type).toBe('session.needs_input')
    expect(published[0]?.sessionId).toBe('sess_1')
    expect((published[0]?.payload as { requestId?: string }).requestId).toBe('question-1')
  })

  test('does not turn transcript flushes into mobile turn completions', () => {
    const { listener, published } = makeHarness()

    listener(IPC.AGENT_CHAT_TRANSCRIPT_CHANGED, {
      sessionId: 'sess_1',
      transcript: [{ kind: 'message', role: 'user', text: 'hello' }],
    })

    expect(published).toHaveLength(0)
  })

  test('only publishes completion after a running state was observed', () => {
    const { listener, published } = makeHarness()

    listener(IPC.AGENT_CHAT_STATE_CHANGED, {
      sessionId: 'sess_1',
      workspaceId: 'ws_1',
      status: 'idle',
      runPhase: 'idle',
    })
    expect(published).toHaveLength(0)

    listener(IPC.AGENT_CHAT_STATE_CHANGED, {
      sessionId: 'sess_1',
      workspaceId: 'ws_1',
      status: 'running',
      runPhase: 'running',
    })
    listener(IPC.AGENT_CHAT_STATE_CHANGED, {
      sessionId: 'sess_1',
      workspaceId: 'ws_1',
      status: 'idle',
      runPhase: 'idle',
    })

    expect(published.map((event) => event.type)).toEqual(['session.started', 'session.message.completed'])
  })
})
