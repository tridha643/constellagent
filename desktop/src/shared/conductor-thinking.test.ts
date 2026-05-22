import { describe, expect, test } from 'bun:test'
import {
  CODEX_THINKING_LEVELS,
  CURSOR_THINKING_LEVELS,
  nextThinkingLevel,
  coerceThinkingLevelForProvider,
  isReasoningEffortActive,
} from './conductor-thinking'

describe('conductor thinking levels', () => {
  test('codex cycle includes Off (minimal) before Low', () => {
    expect(CODEX_THINKING_LEVELS[0]).toBe('minimal')
    expect(nextThinkingLevel('xhigh', 'codex')).toBe('minimal')
    expect(nextThinkingLevel('minimal', 'codex')).toBe('low')
  })

  test('cursor cycle skips minimal', () => {
    expect(CURSOR_THINKING_LEVELS).not.toContain('minimal')
    expect(nextThinkingLevel('xhigh', 'cursor')).toBe('low')
    expect(nextThinkingLevel(undefined, 'cursor')).toBe('medium')
  })

  test('coerceThinkingLevelForProvider folds minimal to low on cursor', () => {
    expect(coerceThinkingLevelForProvider('minimal', 'cursor')).toBe('low')
    expect(coerceThinkingLevelForProvider('minimal', 'codex')).toBe('minimal')
  })

  test('isReasoningEffortActive treats minimal and low as off', () => {
    expect(isReasoningEffortActive('minimal')).toBe(false)
    expect(isReasoningEffortActive('low')).toBe(false)
    expect(isReasoningEffortActive('medium')).toBe(true)
  })
})
