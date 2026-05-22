import { describe, expect, test } from 'bun:test'
import {
  subagentInteractionEffect,
  subagentTaskMessageText,
} from './cursor-driver-deltas'

describe('subagentInteractionEffect', () => {
  test('tracks task tool-call-started and returns status hint', () => {
    const effect = subagentInteractionEffect({
      type: 'tool-call-started',
      callId: 'call-1',
      modelCallId: 'm1',
      toolCall: {
        type: 'task',
        args: {
          description: 'Explore UI',
          prompt: 'Search components',
          subagentType: { kind: 'explore', name: 'quick' },
        },
      },
    })
    expect(effect).toEqual({
      callId: 'call-1',
      text: 'Search components',
      trackCall: true,
    })
  })

  test('maps summary to active subagent call', () => {
    const effect = subagentInteractionEffect(
      { type: 'summary', summary: 'Scanning src/renderer…' },
      'call-9',
    )
    expect(effect).toEqual({ callId: 'call-9', text: 'Scanning src/renderer…' })
  })

  test('ignores non-subagent tools', () => {
    const effect = subagentInteractionEffect({
      type: 'partial-tool-call',
      callId: 'call-2',
      modelCallId: 'm1',
      toolCall: { type: 'shell', args: { command: 'ls' } },
    })
    expect(effect).toBeNull()
  })
})

describe('subagentTaskMessageText', () => {
  test('returns progress for active subagent', () => {
    expect(subagentTaskMessageText('Reviewing diffs…', 'call-3')).toEqual({
      callId: 'call-3',
      text: 'Reviewing diffs…',
    })
  })

  test('returns null without active call', () => {
    expect(subagentTaskMessageText('Done', undefined)).toBeNull()
  })
})
