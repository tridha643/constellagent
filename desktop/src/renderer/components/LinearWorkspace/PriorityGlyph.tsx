import { Tooltip } from '../Tooltip/Tooltip'
import styles from './PriorityGlyph.module.css'

interface PriorityGlyphProps {
  /** Linear priority numeric: 0 (none), 1 (urgent), 2 (high), 3 (medium), 4 (low). */
  priority: number | undefined | null
  /** Render mode. `icon` = glyph with optional tooltip; `inline` = glyph + label. */
  variant?: 'icon' | 'inline'
  /** When true, show Tooltip with the priority label. Defaults to true for `icon` variant. */
  showTooltip?: boolean
}

const PRIORITY_LABEL: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

function toneFor(p: number | undefined | null): string {
  if (p === 1) return 'urgent'
  if (p === 2) return 'high'
  if (p === 3) return 'medium'
  if (p === 4) return 'low'
  return 'none'
}

export function priorityLabel(p: number | undefined | null): string {
  if (p == null) return '—'
  return PRIORITY_LABEL[p] ?? String(p)
}

/**
 * Linear-style priority bars (Low/Medium/High = 1/2/3 filled bars), Urgent = filled
 * triangle, "No priority" = short dash. Dashes/bars tint from the appearance palette.
 */
export function PriorityGlyph({
  priority,
  variant = 'icon',
  showTooltip,
}: PriorityGlyphProps) {
  const label = priorityLabel(priority)
  const tone = toneFor(priority)
  const wantsTooltip = showTooltip ?? variant === 'icon'

  let glyphNode: React.ReactNode
  if (priority === 1) {
    glyphNode = (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M6 1.5L10.6 10H1.4L6 1.5Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <rect x="5.3" y="4" width="1.4" height="3.2" rx="0.4" fill="var(--surface-1)" />
        <rect x="5.3" y="7.8" width="1.4" height="1.4" rx="0.4" fill="var(--surface-1)" />
      </svg>
    )
  } else if (priority === 0 || priority == null) {
    glyphNode = (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        <line
          x1="3"
          y1="6"
          x2="9"
          y2="6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    )
  } else {
    // Bars: 2 = 3 bars full, 3 = 2 bars + 1 dim, 4 = 1 bar + 2 dim
    const full = priority === 2 ? 3 : priority === 3 ? 2 : 1
    const bars = [
      { x: 1.5, height: 3, y: 7.5 },
      { x: 5, height: 5.5, y: 5 },
      { x: 8.5, height: 8, y: 2.5 },
    ]
    glyphNode = (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        {bars.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width="2"
            height={b.height}
            rx="0.6"
            fill="currentColor"
            opacity={i < full ? 1 : 0.25}
          />
        ))}
      </svg>
    )
  }

  const glyph = (
    <span
      className={variant === 'icon' ? styles.iconOnly : styles.icon}
      data-tone={tone}
      aria-label={wantsTooltip ? undefined : label}
    >
      {glyphNode}
    </span>
  )

  if (variant === 'icon') {
    if (!wantsTooltip) return glyph
    return <Tooltip label={label}>{glyph}</Tooltip>
  }

  return (
    <span className={styles.inline} data-tone={tone}>
      {glyph}
      <span className={styles.label}>{label}</span>
    </span>
  )
}
