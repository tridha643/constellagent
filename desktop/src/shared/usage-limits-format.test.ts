import { describe, expect, test } from 'bun:test'
import {
  formatLimitResetAt,
  limitLabelFromWindowMinutes,
  limitLabelFromWindowSeconds,
  percentLeft,
} from './usage-limits-format'

describe('usage-limits-format', () => {
  test('limitLabelFromWindowMinutes maps common Codex windows', () => {
    expect(limitLabelFromWindowMinutes(300)).toBe('5h')
    expect(limitLabelFromWindowMinutes(10_080)).toBe('7d')
  })

  test('limitLabelFromWindowSeconds derives minutes label', () => {
    expect(limitLabelFromWindowSeconds(18_000)).toBe('5h')
    expect(limitLabelFromWindowSeconds(604_800)).toBe('7d')
  })

  test('percentLeft clamps remaining capacity', () => {
    expect(percentLeft(9)).toBe(91)
    expect(percentLeft(110)).toBe(0)
    expect(percentLeft(-5)).toBe(100)
  })

  test('formatLimitResetAt returns localized datetime string', () => {
    const formatted = formatLimitResetAt(Date.UTC(2026, 4, 22, 19, 6, 0))
    expect(formatted).toBeTruthy()
    expect(formatted).toContain('2026')
  })
})
