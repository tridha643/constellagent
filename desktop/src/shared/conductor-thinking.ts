import type { AgentProvider } from './agent-chat-types'

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** All levels (settings + persistence). */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const

/** Codex SDK supports minimal (reasoning off) in addition to low–xhigh. */
export const CODEX_THINKING_LEVELS: readonly ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export const CURSOR_THINKING_LEVELS: readonly ThinkingLevel[] = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  minimal: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
}

export function thinkingLevelsForProvider(provider: AgentProvider): readonly ThinkingLevel[] {
  return provider === 'codex' ? CODEX_THINKING_LEVELS : CURSOR_THINKING_LEVELS
}

export function nextThinkingLevel(
  current: ThinkingLevel | undefined,
  provider: AgentProvider,
): ThinkingLevel {
  const levels = thinkingLevelsForProvider(provider)
  const idx = current ? levels.indexOf(current) : -1
  const base = idx >= 0 ? idx : 0
  return levels[(base + 1) % levels.length]!
}

/** Cursor has no reasoning-off tier — fold minimal to low at the model layer. */
export function coerceThinkingLevelForProvider(
  level: ThinkingLevel,
  provider: AgentProvider,
): ThinkingLevel {
  if (provider !== 'codex' && level === 'minimal') return 'low'
  return level
}

export function normalizeThinkingLevel(value: string | undefined): ThinkingLevel {
  if (value && THINKING_LEVELS.includes(value as ThinkingLevel)) {
    return value as ThinkingLevel
  }
  return 'low'
}

export function isReasoningEffortActive(level: ThinkingLevel): boolean {
  return level !== 'low' && level !== 'minimal'
}
