import { describe, expect, mock, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

mock.module('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'constellagent-adapter-test-userdata'),
    isPackaged: false,
  },
}))

const { __testing } = await import('./mobile-rpc-adapter')

describe('mobile rpc adapter', () => {
  test('parseInboundMobileRpc accepts codex JSON-RPC requests', () => {
    const parsed = __testing.parseInboundMobileRpc(
      JSON.stringify({ id: '1', method: 'model.list', params: { cwd: '/tmp/repo' } }),
    )
    expect(parsed?.id).toBe('1')
    expect(parsed?.method).toBe('model.list')
    expect(parsed?.responseShape).toBe('model.list')
  })

  test('parseInboundMobileRpc normalizes codex method names to bridge methods', () => {
    const parsed = __testing.parseInboundMobileRpc(
      JSON.stringify({ id: '2', method: 'thread/list', params: { cursor: null } }),
    )
    expect(parsed?.method).toBe('session.list')
    expect(parsed?.responseShape).toBe('session.list')
  })

  test('mapCodexMethodToBridge mirrors iOS protocol mapping', () => {
    expect(__testing.mapCodexMethodToBridge('model/list')).toBe('model.list')
    expect(__testing.mapCodexMethodToBridge('thread/start')).toBe('session.start')
    expect(__testing.mapCodexMethodToBridge('turn/start')).toBe('session.reply')
    expect(__testing.mapCodexMethodToBridge('turn/steer')).toBe('session.reply')
    expect(__testing.mapCodexMethodToBridge('thread/resume')).toBe('session.resume')
  })

  test('coerceResumeInsteadOfStart routes threadId-bearing session.start to session.resume', () => {
    const inbound = __testing.parseInboundMobileRpc(
      JSON.stringify({
        id: 'resume-1',
        method: 'session.start',
        params: { threadId: 'sess_existing', excludeTurns: true },
      }),
    )!
    const request = __testing.adaptInboundRequest(inbound)
    expect(request.method).toBe('session.resume')
    expect(request.params).toEqual({ sessionId: 'sess_existing', excludeTurns: true })
  })

  test('adaptInboundParams maps thread/start cwd to session.start workspacePath', () => {
    const params = __testing.adaptInboundParams('session.start', {
      cwd: '/Users/me/worktrees/feature-a',
      model: 'claude-sonnet-4',
    })
    expect(params.workspacePath).toBe('/Users/me/worktrees/feature-a')
    expect(params.provider).toBe('pi')
    expect(params.model).toBe('claude-sonnet-4')
  })

  test('adaptInboundParams maps turn/start input to session.reply text', () => {
    const params = __testing.adaptInboundParams('session.reply', {
      threadId: 'sess_1',
      input: [{ type: 'text', text: 'hello from iOS' }],
    })
    expect(params).toEqual({ sessionId: 'sess_1', text: 'hello from iOS' })
  })

  test('adaptInboundRequest maps turn/steer to a steer reply instead of cancel', () => {
    const inbound = __testing.parseInboundMobileRpc(
      JSON.stringify({
        id: 'steer-1',
        method: 'turn/steer',
        params: {
          threadId: 'sess_1',
          input: [{ type: 'text', text: 'steer from iOS' }],
        },
      }),
    )!
    const request = __testing.adaptInboundRequest(inbound)
    expect(request.method).toBe('session.reply')
    expect(request.params).toEqual({ sessionId: 'sess_1', text: 'steer from iOS', deliverAs: 'steer' })
  })

  test('adaptOutboundResult maps model.list items for iOS decoders', () => {
    const result = __testing.adaptOutboundResult(
      'model.list',
      {
        items: [
          { id: 'claude-opus-4', model: 'claude-opus-4', displayName: 'Opus 4', isDefault: true },
        ],
      },
      {},
    )
    expect(result).toEqual({
      items: [{ id: 'claude-opus-4', model: 'claude-opus-4', displayName: 'Opus 4', isDefault: true }],
    })
  })

  test('adaptOutboundResult maps session.start to codex thread object', () => {
    const result = __testing.adaptOutboundResult(
      'session.start',
      {
        session: {
          sessionId: 'sess_1',
          workspaceId: 'ws-1',
          workspacePath: '/tmp/ws',
          title: 'Worktree chat',
          model: 'claude-sonnet-4',
          provider: 'pi',
          createdAt: '2026-05-24T12:00:00.000Z',
          updatedAt: '2026-05-24T12:00:00.000Z',
        },
      },
      {},
    ) as { thread: { id: string; cwd: string } }
    expect(result.thread.id).toBe('sess_1')
    expect(result.thread.cwd).toBe('/tmp/ws')
  })

  test('adaptOutboundResult maps session.resume with embedded turns', () => {
    const result = __testing.adaptOutboundResult(
      'session.resume',
      {
        session: {
          sessionId: 'sess_1',
          workspaceId: 'ws-1',
          workspacePath: '/tmp/ws',
          title: 'Worktree chat',
          model: 'claude-sonnet-4',
          provider: 'pi',
          createdAt: '2026-05-24T12:00:00.000Z',
          updatedAt: '2026-05-24T12:00:00.000Z',
        },
        transcript: [
          { kind: 'message', id: 'm1', role: 'user', text: 'hi' },
          { kind: 'message', id: 'm2', role: 'assistant', text: 'hello' },
        ],
      },
      {},
    ) as { thread: { id: string; turns: unknown[] } }
    expect(result.thread.id).toBe('sess_1')
    expect(result.thread.turns.length).toBeGreaterThan(0)
  })

  test('adaptOutboundEvent converts session.message.delta to item/agentMessage/delta', () => {
    const notification = __testing.adaptOutboundEvent({
      type: 'session.message.delta',
      sessionId: 'sess_1',
      payload: { text: 'partial', messageId: 'msg_1' },
    })
    expect(notification?.method).toBe('item/agentMessage/delta')
    const params = notification?.params as { delta: string; turnId: string; itemId: string }
    expect(params.delta).toBe('partial')
    expect(params.turnId).toBe('sess_1-turn')
    expect(params.itemId).toBe('msg_1')
  })

  test('adaptOutboundEvent maps failed session completion to turn/completed with error', () => {
    const notification = __testing.adaptOutboundEvent({
      type: 'session.message.completed',
      sessionId: 'sess_1',
      payload: { status: 'failed', error: 'Driver unavailable' },
    })
    expect(notification?.method).toBe('turn/completed')
    const params = notification?.params as { turnId: string; status: string; error: { message: string } }
    expect(params.turnId).toBe('sess_1-turn')
    expect(params.status).toBe('failed')
    expect(params.error.message).toBe('Driver unavailable')
  })

  test('adaptOutboundEvent maps awaiting-user state to an iOS requestUserInput RPC', () => {
    const request = __testing.adaptOutboundEvent({
      type: 'session.needs_input',
      sessionId: 'sess_1',
      payload: {
        requestId: 'question-1',
        callId: 'call-1',
        questions: [
          {
            header: 'Plan',
            question: 'Which path should I take?',
            options: [{ label: 'Fast path' }, { label: 'Safe path', description: 'Add tests first' }],
            multiSelect: false,
          },
        ],
      },
    })
    expect(request?.id).toBe('question-1')
    expect(request?.method).toBe('item/tool/requestUserInput')
    const params = request?.params as { threadId: string; questions: Array<{ id: string; selectionLimit: number; options: Array<{ description: string }> }> }
    expect(params.threadId).toBe('sess_1')
    expect(params.questions[0]?.id).toBe('question-1-q1')
    expect(params.questions[0]?.selectionLimit).toBe(1)
    expect(params.questions[0]?.options[0]?.description).toBe('')
  })

  test('adaptStructuredUserInputResponse converts iOS answers into desktop blocking-question details', () => {
    const details = __testing.adaptStructuredUserInputResponse(
      {
        id: 'question-1',
        result: {
          answers: {
            'question-1-q1': { answers: ['Safe path'] },
          },
        },
      },
      {
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
            options: [{ label: 'Fast path' }, { label: 'Safe path', description: 'Add tests first' }],
          },
        ],
      },
    )
    expect(details.cancelled).toBe(false)
    expect(details.answers[0]?.answer).toBe('Safe path')
    expect(details.answers[0]?.selectedOptions).toEqual(['Safe path'])
    expect(details.answers[0]?.wasCustom).toBe(false)
  })

  test('adaptOutboundResponse maps session_not_found to a specific JSON-RPC code', () => {
    const inbound = __testing.parseInboundMobileRpc(
      JSON.stringify({ id: '3', method: 'session.history', params: { threadId: 'missing' } }),
    )!
    const outbound = __testing.adaptOutboundResponse(inbound, {
      kind: 'rpcResponse',
      id: '3',
      error: { code: 'session_not_found', message: 'Unknown session: missing' },
    }) as { error: { code: number; message: string; data: { bridgeCode: string } } }
    expect(outbound.error.code).toBe(-32001)
    expect(outbound.error.data.bridgeCode).toBe('session_not_found')
  })

  test('adaptOutboundResponse preserves the original phone request id', () => {
    const inbound = __testing.parseInboundMobileRpc(
      JSON.stringify({ id: 'phone-request-1', method: 'turn/start', params: { threadId: 'sess_1', text: 'hello' } }),
    )!
    const outbound = __testing.adaptOutboundResponse(inbound, {
      kind: 'rpcResponse',
      id: 'router-id-should-not-leak',
      result: { ok: true },
    }) as { id: string; result: { turn: { id: string } } }

    expect(outbound.id).toBe('phone-request-1')
    expect(outbound.result.turn.id).toBe('sess_1-turn')
  })
})
