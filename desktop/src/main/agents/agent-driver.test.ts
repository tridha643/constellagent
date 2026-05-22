import { describe, expect, test } from 'bun:test'
import type { TranscriptMessage } from '../../shared/pi/pi-desktop-state'
import { buildAgentPrompt, PLAN_PROMPT_PREFIX } from './agent-driver'

function msg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  conductorPlan = false,
): TranscriptMessage {
  const base: TranscriptMessage = { kind: 'message', id, role, text, createdAt: '' }
  return conductorPlan ? { ...base, conductorPlan: true } : base
}

describe('agent-driver prompt construction', () => {
  test('keeps the legacy prompt shape when no previous transcript is supplied', () => {
    const prompt = buildAgentPrompt('implement it now', false)

    expect(prompt).toEndWith('\n\nimplement it now')
    expect(prompt).not.toContain('Previous conversation context')
  })

  test('adds prior chat context before the current user request', () => {
    const previous: TranscriptMessage[] = [
      msg('u1', 'user', 'create a plan first', true),
      msg('a1', 'assistant', '## Plan\n\n- [ ] Preserve thread context'),
    ]

    const prompt = buildAgentPrompt('ok go implement it now', false, previous)

    expect(prompt).toContain('Previous conversation context')
    expect(prompt).toContain('### User (plan mode)')
    expect(prompt).toContain('## Plan')
    expect(prompt).toContain('Current user request:\nok go implement it now')
  })

  test('combines plan mode instructions with previous chat context', () => {
    const prompt = buildAgentPrompt(
      'revise the plan',
      true,
      [msg('u1', 'user', 'old request')],
    )

    expect(prompt).toContain(PLAN_PROMPT_PREFIX)
    expect(prompt).toContain('Previous conversation context')
    expect(prompt).toContain('Current user request:\nrevise the plan')
  })
})
