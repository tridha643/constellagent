import { describe, expect, test } from 'bun:test'
import {
  buildComposerContextWindowData,
  buildContextWindowData,
  computeContextPercentage,
  estimateTokensFromComposerMessage,
  estimateTokensFromTranscript,
  inferContextWindowSize,
} from './context-window-utils'
import type { QueuedAgentMessage } from './agent-chat-types'
import type { TranscriptMessage } from './pi/pi-desktop-state'

describe('context-window-utils', () => {
  test('inferContextWindowSize is model-based and stable near the 200k boundary', () => {
    expect(inferContextWindowSize('claude-sonnet-4-6-1m', 0)).toBe(1_000_000)
    expect(inferContextWindowSize('gpt-5.4', 0)).toBe(1_000_000)
    expect(inferContextWindowSize('gpt-5.5', 0)).toBe(1_000_000)
    expect(inferContextWindowSize('claude-4.6-sonnet', 0)).toBe(1_000_000)
    expect(inferContextWindowSize('composer-2', 190_000)).toBe(200_000)
  })

  test('estimateTokensFromTranscript counts message, summary, tool text, and bounded attachments', () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: 'message',
        id: 'u1',
        role: 'user',
        text: 'abcd',
        attachments: [
          {
            kind: 'image',
            name: 'screenshot.png',
            mimeType: 'image/png',
            data: 'x'.repeat(2_000_000),
          },
        ],
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
      {
        kind: 'summary',
        id: 's1',
        label: 'abcd',
        presentation: 'inline',
        createdAt: '2026-01-01T00:00:02.000Z',
      },
    ]
    expect(estimateTokensFromTranscript(transcript)).toBe(1 + 1028 + 4 + 1)
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

  test('estimateTokensFromComposerMessage treats image-only prompts as bounded image inputs', () => {
    const tokens = estimateTokensFromComposerMessage('', [
      {
        kind: 'image',
        name: 'large.png',
        data: 'x'.repeat(8_000_000),
      },
    ])
    expect(tokens).toBeGreaterThan(1_024)
    expect(tokens).toBeLessThan(1_100)
  })

  test('buildComposerContextWindowData combines remote, local transcript, queued, and draft tokens', () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: 'message',
        id: 'u1',
        role: 'user',
        text: 'abcd',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const queuedMessages: QueuedAgentMessage[] = [
      {
        id: 'q1',
        mode: 'followUp',
        text: 'abcd',
        attachments: [],
        createdAt: '2026-01-01T00:00:01.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
      },
    ]

    const data = buildComposerContextWindowData({
      model: 'gpt-5.4',
      sessionId: 's1',
      baseUsage: buildContextWindowData({ usedTokens: 10, model: 'gpt-5.4', sessionId: 's1' }),
      transcript,
      queuedMessages,
      draftText: 'abcdefgh',
    })

    expect(data.usedTokens).toBe(13)
    expect(data.contextWindowSize).toBe(1_000_000)
    expect(data.sessionId).toBe('s1')
  })

  test('buildComposerContextWindowData estimates a draft before a session exists', () => {
    const data = buildComposerContextWindowData({
      model: 'gpt-5.4',
      draftText: 'a'.repeat(4_000),
    })
    expect(data.usedTokens).toBe(1_000)
    expect(data.contextWindowSize).toBe(1_000_000)
    expect(data.sessionId).toBe('')
  })
})
