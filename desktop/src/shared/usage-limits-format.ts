/** Map Codex window length (minutes) to a compact label matching Cursor/Codex TUI. */
export function limitLabelFromWindowMinutes(windowMinutes: number | null | undefined): string {
  if (windowMinutes == null || !Number.isFinite(windowMinutes)) return 'limit'
  if (windowMinutes === 300 || windowMinutes === 5 * 60) return '5h'
  if (windowMinutes === 10_080 || windowMinutes === 7 * 24 * 60) return '7d'
  if (windowMinutes >= 24 * 60 && windowMinutes % (24 * 60) === 0) {
    const days = windowMinutes / (24 * 60)
    return `${days}d`
  }
  if (windowMinutes >= 60 && windowMinutes % 60 === 0) {
    const hours = windowMinutes / 60
    return `${hours}h`
  }
  return `${windowMinutes}m`
}

export function limitLabelFromWindowSeconds(windowSeconds: number | null | undefined): string {
  if (windowSeconds == null || !Number.isFinite(windowSeconds)) return 'limit'
  return limitLabelFromWindowMinutes(Math.round(windowSeconds / 60))
}

/** Format reset time like Cursor: "May 22, 2026, 3:06 PM". */
export function formatLimitResetAt(resetsAtMs: number | null): string | null {
  if (resetsAtMs == null || !Number.isFinite(resetsAtMs)) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(resetsAtMs))
}

export function percentLeft(usedPercent: number): number {
  return Math.max(0, Math.min(100, 100 - usedPercent))
}
