export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh'

export const THINKING_LEVELS: readonly ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh'] as const

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
}

export function nextThinkingLevel(current: ThinkingLevel | undefined): ThinkingLevel {
  const idx = current ? THINKING_LEVELS.indexOf(current) : -1
  const base = idx >= 0 ? idx : 0
  return THINKING_LEVELS[(base + 1) % THINKING_LEVELS.length]!
}

export function normalizeThinkingLevel(value: string | undefined): ThinkingLevel {
  if (value && THINKING_LEVELS.includes(value as ThinkingLevel)) {
    return value as ThinkingLevel
  }
  return 'low'
}
