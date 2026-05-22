import { describe, expect, test } from 'bun:test'
import type { AgentChatSessionState } from '../shared/agent-chat-types'

describe('AgentChatHost blocking question guard', () => {
  test('awaitingUser blocks new submits at the type level', () => {
    const state: AgentChatSessionState = {
      sessionId: 's1',
      workspaceId: 'w1',
      workspacePath: '/tmp',
      title: 'Test',
      provider: 'cursor',
      model: 'gpt-4',
      thinkingLevel: 'medium',
      plan: true,
      status: 'running',
      runPhase: 'awaitingUser',
      blockingQuestion: {
        requestId: 'r1',
        sessionId: 's1',
        callId: 'c1',
        provider: 'cursor',
        source: 'askQuestion',
        questions: [
          {
            header: 'Scope',
            question: 'Which platform?',
            options: [{ label: 'Desktop' }],
          },
        ],
        createdAt: new Date().toISOString(),
      },
      queuedMessages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    expect(state.runPhase).toBe('awaitingUser')
    expect(state.blockingQuestion?.questions).toHaveLength(1)
  })
})
