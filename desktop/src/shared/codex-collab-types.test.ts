import { describe, expect, test } from 'bun:test'
import {
  collabAgentSucceeded,
  isCollabAgentTerminal,
  isCollabToolCallItem,
} from './codex-collab-types'

describe('isCollabToolCallItem', () => {
  test('accepts spawn_agent collab items', () => {
    expect(
      isCollabToolCallItem({
        id: 'spawn-1',
        type: 'collab_tool_call',
        tool: 'spawn_agent',
        sender_thread_id: 'parent',
        receiver_thread_ids: ['child-a'],
        prompt: 'Explore repo',
        agents_states: {},
        status: 'completed',
      }),
    ).toBe(true)
  })

  test('rejects unknown item types', () => {
    expect(isCollabToolCallItem({ id: 'x', type: 'command_execution' })).toBe(false)
  })
})

describe('collab agent terminal helpers', () => {
  test('detects terminal statuses', () => {
    expect(isCollabAgentTerminal('running')).toBe(false)
    expect(isCollabAgentTerminal('completed')).toBe(true)
    expect(isCollabAgentTerminal('errored')).toBe(true)
  })

  test('maps success only for completed', () => {
    expect(collabAgentSucceeded('completed')).toBe(true)
    expect(collabAgentSucceeded('errored')).toBe(false)
  })
})
