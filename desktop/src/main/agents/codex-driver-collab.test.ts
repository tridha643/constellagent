import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { SessionDriverEvent } from '@pi-gui/session-driver'
import { isCollabToolCallItem } from '../../shared/codex-collab-types'
import type { AgentTurnContext } from './agent-driver'
import {
  createCodexCollabSessionState,
  handleCodexCollabItem,
} from './codex-driver-collab'

const sessionRef = { projectId: 'p', workspaceId: 'w', sessionId: 's' }

function replayFixture(path: string): SessionDriverEvent[] {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const events: SessionDriverEvent[] = []
  const ctx = {
    sessionRef,
    emit: (event: SessionDriverEvent) => {
      events.push(event)
    },
  } as AgentTurnContext

  const collab = createCodexCollabSessionState()
  const throttle = new Map<string, { text: string; emittedAt: number }>()
  let clock = 0
  const originalNow = performance.now.bind(performance)
  performance.now = () => {
    clock += 200
    return clock
  }

  try {
    for (const line of lines) {
      const parsed = JSON.parse(line) as { type?: string; item?: unknown }
      if (
        parsed.type !== 'item.started' &&
        parsed.type !== 'item.updated' &&
        parsed.type !== 'item.completed'
      ) {
        continue
      }
      if (!isCollabToolCallItem(parsed.item)) continue
      handleCodexCollabItem(ctx, collab, throttle, parsed.type, parsed.item)
    }
  } finally {
    performance.now = originalNow
  }

  return events
}

describe('handleCodexCollabItem fixture replay', () => {
  test('maps spawn + wait collab JSONL to subagent timeline events', () => {
    const fixture = new URL('./__fixtures__/codex-collab-spawn-wait.jsonl', import.meta.url)
    const events = replayFixture(fixture.pathname)

    const started = events.filter((event) => event.type === 'toolStarted')
    const updated = events.filter((event) => event.type === 'toolUpdated')
    const finished = events.filter((event) => event.type === 'toolFinished')

    expect(started).toHaveLength(2)
    expect(started.map((event) => event.callId).sort()).toEqual(['child-a', 'child-b'])
    expect(started.every((event) => event.type === 'toolStarted' && event.toolName === 'spawn_agent')).toBe(
      true,
    )

    expect(updated.length).toBeGreaterThanOrEqual(2)
    expect(updated.some((event) => event.text?.includes('Found 12 files'))).toBe(true)

    expect(finished).toHaveLength(2)
    expect(finished.every((event) => event.type === 'toolFinished' && event.success)).toBe(true)
  })
})

describe('handleCodexCollabItem wait failure', () => {
  test('marks unfinished children as failed when wait collab fails', () => {
    const events: SessionDriverEvent[] = []
    const ctx = {
      sessionRef,
      emit: (event: SessionDriverEvent) => {
        events.push(event)
      },
    } as AgentTurnContext
    const collab = createCodexCollabSessionState()
    const throttle = new Map<string, { text: string; emittedAt: number }>()

    handleCodexCollabItem(ctx, collab, throttle, 'item.completed', {
      id: 'spawn-1',
      type: 'collab_tool_call',
      tool: 'spawn_agent',
      sender_thread_id: 'parent',
      receiver_thread_ids: ['child-x'],
      prompt: 'Explore UI',
      agents_states: {},
      status: 'completed',
    })

    handleCodexCollabItem(ctx, collab, throttle, 'item.completed', {
      id: 'wait-1',
      type: 'collab_tool_call',
      tool: 'wait',
      sender_thread_id: 'parent',
      receiver_thread_ids: ['child-x'],
      agents_states: {
        'child-x': { status: 'running', message: 'Still working…' },
      },
      status: 'failed',
    })

    const finished = events.find((event) => event.type === 'toolFinished' && event.callId === 'child-x')
    expect(finished?.type).toBe('toolFinished')
    if (finished?.type === 'toolFinished') {
      expect(finished.success).toBe(false)
    }
  })
})
