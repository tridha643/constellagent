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

  test('keeps markdown rendering and raster-image safeguards in the app prompt', () => {
    const prompt = buildAgentPrompt('draw the service flow', false)

    expect(prompt).toContain('GitHub-Flavored Markdown')
    expect(prompt).toContain('fenced Mermaid blocks')
    expect(prompt).toContain('xychart-beta')
    expect(prompt).toContain('Do not invoke image generation tools')
    expect(prompt).toContain('Only generate raster images when the user explicitly asks')
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

  test('plan mode tells agents to render plans in chat without file writes', () => {
    const prompt = buildAgentPrompt('plan the change', true)

    expect(prompt).toContain('Do not edit, create, delete, rename, format, or save files anywhere.')
    expect(prompt).toContain('Do not write plan files.')
    expect(prompt).toContain('Return the plan directly in the Conductor chat response')
  })

  test('passes harness slash commands through without Conductor wrapping', () => {
    expect(buildAgentPrompt('/compact', false)).toBe('/compact')
    expect(buildAgentPrompt('/add-dir src/lib', false)).toBe('/add-dir src/lib')
  })

  test('wraps skill-like slash text instead of treating it as an immediate command', () => {
    const prompt = buildAgentPrompt('/caveman', false)

    expect(prompt).toContain('GitHub-Flavored Markdown')
    expect(prompt).toEndWith('\n\n/caveman')
  })

  test('passes Pi slash commands through as raw runtime commands', () => {
    expect(buildAgentPrompt('/ask-user-question align on scope', false, undefined, 'pi')).toBe(
      '/ask-user-question align on scope',
    )
  })
})
