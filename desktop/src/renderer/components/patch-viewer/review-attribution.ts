import type { DiffAnnotation } from '@shared/diff-annotation-types'
import { classifyReviewer } from './review-threads'

/** Avatar palette + time formatting shared by the thread card and reviewer summary. */

const AVATAR_COLORS: Record<string, { bg: string; text: string }> = {
  you: { bg: 'rgba(59, 130, 246, 0.2)', text: 'rgb(147, 197, 253)' },
  cursor: { bg: 'rgba(168, 85, 247, 0.2)', text: 'rgb(192, 132, 252)' },
  'claude-code': { bg: 'rgba(251, 146, 60, 0.2)', text: 'rgb(253, 186, 116)' },
  codex: { bg: 'rgba(52, 211, 153, 0.2)', text: 'rgb(110, 231, 183)' },
  gemini: { bg: 'rgba(56, 189, 248, 0.2)', text: 'rgb(125, 211, 252)' },
}

export function getAvatarStyle(name: string): { bg: string; text: string } {
  const key = name.toLowerCase()
  if (AVATAR_COLORS[key]) return AVATAR_COLORS[key]
  const hash = key.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const hue = hash % 360
  return { bg: `hsla(${hue}, 60%, 50%, 0.2)`, text: `hsl(${hue}, 70%, 75%)` }
}

export function reviewerDisplayName(annotation: DiffAnnotation): string {
  const kind = classifyReviewer(annotation)
  if (kind === 'local-human') return 'You'
  return annotation.author ?? (kind === 'github' ? 'GitHub' : 'Agent')
}

export function formatTimeAgo(isoDate: string): string {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

export function modShortcutHintLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl'
}

export function reviewAnnotationErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.split('\n')[0] ?? 'Review annotation action failed'
}
