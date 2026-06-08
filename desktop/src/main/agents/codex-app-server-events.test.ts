import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createCodexAppServerEventMapperState,
  mapAppServerNotification,
  mapAppServerThreadItem,
} from './codex-app-server-events'

describe('codex app-server event mapping', () => {
  test('maps thread and turn lifecycle notifications', () => {
    const state = createCodexAppServerEventMapperState()
    expect(mapAppServerNotification('thread/started', { threadId: 'thread-1' }, state)).toEqual([
      { type: 'thread.started', thread_id: 'thread-1' },
    ])
    expect(mapAppServerNotification('turn/started', { turnId: 'turn-1' }, state)).toEqual([
      { type: 'turn.started' },
    ])
    expect(state.activeTurnId).toBe('turn-1')
    mapAppServerNotification('thread/tokenUsage/updated', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tokenUsage: {
        total: {
          inputTokens: 1000,
          cachedInputTokens: 250,
          outputTokens: 10,
          reasoningOutputTokens: 0,
          totalTokens: 1260,
        },
      },
    }, state)
    expect(mapAppServerNotification('turn/completed', { turn: { id: 'turn-1' } }, state)).toEqual([
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 1000,
          cached_input_tokens: 250,
          output_tokens: 0,
        },
      },
    ])
  })

  test('maps agent message deltas into started and updated items', () => {
    const state = createCodexAppServerEventMapperState()
    const first = mapAppServerNotification('item/agentMessage/delta', {
      itemId: 'msg-1',
      delta: 'Hello',
    }, state)
    expect(first).toEqual([
      {
        type: 'item.started',
        item: { id: 'msg-1', type: 'agent_message', text: 'Hello' },
      },
      {
        type: 'item.updated',
        item: { id: 'msg-1', type: 'agent_message', text: 'Hello' },
      },
    ])
    const second = mapAppServerNotification('item/agentMessage/delta', {
      itemId: 'msg-1',
      delta: ' world',
    }, state)
    expect(second).toEqual([
      {
        type: 'item.updated',
        item: { id: 'msg-1', type: 'agent_message', text: 'Hello world' },
      },
    ])
  })

  test('maps app-server thread items to exec thread item shapes', () => {
    expect(
      mapAppServerThreadItem({
        id: 'cmd-1',
        type: 'commandExecution',
        command: 'ls',
        cwd: '/tmp',
        commandActions: [],
        status: 'completed',
        aggregatedOutput: 'README.md',
        exitCode: 0,
      }),
    ).toEqual({
      id: 'cmd-1',
      type: 'command_execution',
      command: 'ls',
      aggregated_output: 'README.md',
      exit_code: 0,
      status: 'completed',
    })
    expect(
      mapAppServerThreadItem({
        id: 'collab-1',
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        senderThreadId: 'parent-1',
        receiverThreadIds: ['child-1'],
        agentsStates: {
          'child-1': { status: 'running', message: 'Searching…' },
        },
        status: 'inProgress',
        prompt: 'Find auth code',
      }),
    ).toMatchObject({
      id: 'collab-1',
      type: 'collab_tool_call',
      tool: 'spawn_agent',
      sender_thread_id: 'parent-1',
      receiver_thread_ids: ['child-1'],
      status: 'in_progress',
    })
  })

  test('maps recorded ask-user fixture lines without crashing', () => {
    const fixturePath = join(import.meta.dir, '__fixtures__', 'codex-app-server-ask-user.jsonl')
    const lines = readFileSync(fixturePath, 'utf8').trim().split('\n')
    const state = createCodexAppServerEventMapperState()
    const events = lines.flatMap((line) => {
      const message = JSON.parse(line) as { method: string; params: unknown }
      return mapAppServerNotification(message.method, message.params, state)
    })
    expect(events.some((event) => event.type === 'thread.started')).toBe(true)
    expect(events.some((event) => event.type === 'turn.completed')).toBe(true)
    expect(events.some((event) => event.type === 'item.started')).toBe(true)
  })
})
