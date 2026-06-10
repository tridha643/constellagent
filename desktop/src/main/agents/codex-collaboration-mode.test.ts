import { describe, expect, test } from 'bun:test'
import {
  CODEX_DEFAULT_MODE_ASK_INSTRUCTIONS,
  CODEX_PLAN_TURN_ASK_INSTRUCTIONS,
  buildCodexCollaborationMode,
  isCollaborationModeUnsupportedError,
} from './codex-collaboration-mode'

describe('buildCodexCollaborationMode', () => {
  test('builds default-mode payload with snake_case settings mirroring model/effort', () => {
    const payload = buildCodexCollaborationMode('gpt-5.2-codex', 'high')
    expect(payload).toEqual({
      mode: 'default',
      settings: {
        model: 'gpt-5.2-codex',
        reasoning_effort: 'high',
        developer_instructions: CODEX_DEFAULT_MODE_ASK_INSTRUCTIONS,
      },
    })
  })

  test('plan turns swap in the non-mutating frame but keep the asking guidance', () => {
    const payload = buildCodexCollaborationMode('gpt-5.2-codex', 'medium', true)
    expect(payload.settings.developer_instructions).toBe(CODEX_PLAN_TURN_ASK_INSTRUCTIONS)
    expect(payload.settings.developer_instructions).toContain('do not edit repo-tracked files')
    expect(payload.settings.developer_instructions).toContain('request_user_input')
  })

  test('instructions flip the stock stance: encourage asking, keep guardrails', () => {
    for (const instructions of [
      CODEX_DEFAULT_MODE_ASK_INSTRUCTIONS,
      CODEX_PLAN_TURN_ASK_INSTRUCTIONS,
    ]) {
      expect(instructions).toContain('request_user_input')
      expect(instructions).toContain('When in doubt about whether to ask: ask.')
      // Explore-first guard against asking discoverable facts.
      expect(instructions).toContain('Do not ask about facts discoverable from the repo')
      // Matches the tool contract: recommended option first, max 3 questions.
      expect(instructions).toContain('(Recommended)')
      expect(instructions).toContain('up to 3 questions')
      // Preserved invariant from codex's built-in default template.
      expect(instructions).toContain(
        'Never write a multiple-choice question as a plain-text assistant message',
      )
    }
  })
})

describe('isCollaborationModeUnsupportedError', () => {
  test('matches server rejections of the experimental param', () => {
    expect(
      isCollaborationModeUnsupportedError(new Error('unknown field `collaborationMode`')),
    ).toBe(true)
    expect(isCollaborationModeUnsupportedError(new Error('Invalid params (code -32602)'))).toBe(
      true,
    )
    expect(
      isCollaborationModeUnsupportedError(
        new Error('experimental API turn/start.collaborationMode not enabled'),
      ),
    ).toBe(true)
  })

  test('does not match unrelated turn failures', () => {
    expect(isCollaborationModeUnsupportedError(new Error('Codex app-server exited (code 1)'))).toBe(
      false,
    )
    expect(isCollaborationModeUnsupportedError(new Error('turn interrupted'))).toBe(false)
    expect(isCollaborationModeUnsupportedError('not an error')).toBe(false)
  })
})
