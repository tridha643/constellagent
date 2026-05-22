import { describe, expect, test } from 'bun:test'
import {
  buildContextWindowData,
  computeContextPercentage,
  estimateTokensFromTranscript,
  inferContextWindowSize,
} from './context-window-utils'
import type { TranscriptMessage } from './pi/pi-desktop-state'

describe('context-window-utils', () => {
  test('inferContextWindowSize picks 1M for large models or usage', () => {
    expect(inferContextWindowSize('claude-sonnet-4-6-1m', 0)).toBe(1_000_000)
    expect(inferContextWindowSize('gpt-5.5', 190_000)).toBe(1_000_000)
    expect(inferContextWindowSize('composer-2', 10_000)).toBe(200_000)
  })

  test('estimateTokensFromTranscript counts message and tool text', () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: 'message',
        id: 'u1',
        role: 'user',
        text: 'abcd',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        kind: 'tool',
        id: 't1',
        callId: 'c1',
        toolName: 'shell',
        status: 'success',
        label: 'Run command',
        detail: 'abcd',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ]
    expect(estimateTokensFromTranscript(transcript)).toBe(5)
  })

  test('buildContextWindowData keeps percentage aligned with token ratio', () => {
    const data = buildContextWindowData({
      usedTokens: 50_000,
      model: 'composer-2',
      sessionId: 's1',
    })
    expect(data.contextWindowSize).toBe(200_000)
    expect(data.percentage).toBe(computeContextPercentage(50_000, 200_000))
    expect(data.percentage).toBe(25)
  })
})
