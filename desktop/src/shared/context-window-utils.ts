import type { ContextWindowData } from './context-window-types'
import type { TranscriptMessage } from './pi/pi-desktop-state'

const CHARS_PER_TOKEN = 4

export function inferContextWindowSize(model: string, usedTokens: number): number {
  if (/1m|1M/i.test(model) || usedTokens > 180_000) {
    return 1_000_000
  }
  return 200_000
}

export function computeContextPercentage(usedTokens: number, contextWindowSize: number): number {
  const total = Math.max(1, contextWindowSize)
  return Math.min(100, Math.max(0, Math.round((usedTokens / total) * 1000) / 10))
}

function estimateChars(value: unknown, depth = 0): number {
  if (value == null || depth > 2) return 0
  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + estimateChars(item, depth + 1), 0)
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce(
      (sum, item) => sum + estimateChars(item, depth + 1),
      0,
    )
  }
  return 0
}

/** Rough token estimate from Conductor transcript rows (messages, tools, activity). */
export function estimateTokensFromTranscript(transcript: readonly TranscriptMessage[]): number {
  let chars = 0

  for (const item of transcript) {
    switch (item.kind) {
      case 'message':
        chars += item.text.length
        break
      case 'tool':
        chars += item.label.length
        chars += item.detail?.length ?? 0
        chars += item.metadata?.length ?? 0
        chars += Math.min(estimateChars(item.input), 8_000)
        chars += Math.min(estimateChars(item.output), 8_000)
        break
      case 'activity':
        chars += item.label.length
        chars += item.detail?.length ?? 0
        chars += item.metadata?.length ?? 0
        break
      default:
        break
    }
  }

  return Math.ceil(chars / CHARS_PER_TOKEN)
}

export function buildContextWindowData(input: {
  usedTokens: number
  model: string
  sessionId: string
  contextWindowSize?: number
}): ContextWindowData {
  const contextWindowSize = input.contextWindowSize ?? inferContextWindowSize(input.model, input.usedTokens)
  return {
    usedTokens: Math.max(0, input.usedTokens),
    contextWindowSize,
    percentage: computeContextPercentage(input.usedTokens, contextWindowSize),
    model: input.model,
    sessionId: input.sessionId,
    lastUpdated: Date.now(),
  }
}

export const CONDUCTOR_CONTEXT_IDLE: ContextWindowData = {
  usedTokens: 0,
  contextWindowSize: 200_000,
  percentage: 0,
  model: '',
  sessionId: '',
  lastUpdated: 0,
}
