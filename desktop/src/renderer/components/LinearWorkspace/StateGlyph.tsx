import {
  CheckCircle,
  Circle,
  CircleDashed,
  Pulse,
  Tray,
  XCircle,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Tooltip } from '../Tooltip/Tooltip'
import type { LinearIssueNode } from '../../linear/linear-api'
import styles from './StateGlyph.module.css'

interface StateGlyphProps {
  /** The Linear issue's state payload (may be null when unresolved). */
  state: LinearIssueNode['state']
  /** Render mode. `icon` = just the glyph (tooltip optional); `inline` = glyph + label. */
  variant?: 'icon' | 'inline'
  /** When true (default for icon variant), wraps the glyph in a Tooltip with the state name. */
  showTooltip?: boolean
  /** Icon size in px. Defaults: 14 (icon), 16 (inline). */
  size?: number
}

interface GlyphResolved {
  node: ReactNode
  /** Tailwind-ish accent color token for the glyph. */
  tone: 'neutral' | 'progress' | 'done' | 'canceled' | 'backlog' | 'triage'
}

function resolveGlyph(
  state: LinearIssueNode['state'],
  size: number,
): GlyphResolved {
  const label = state?.name ?? '—'
  const type = state?.type?.toLowerCase() ?? ''
  const name = state?.name?.toLowerCase() ?? ''
  const iconProps = {
    size,
    weight: 'duotone' as const,
    'aria-label': label,
  } as const
  if (type === 'completed' || name.includes('complete') || name.includes('done')) {
    return { node: <CheckCircle {...iconProps} />, tone: 'done' }
  }
  if (type === 'canceled' || type === 'cancelled' || name.includes('cancel')) {
    return { node: <XCircle {...iconProps} />, tone: 'canceled' }
  }
  if (type === 'started') {
    return { node: <Pulse {...iconProps} />, tone: 'progress' }
  }
  if (type === 'unstarted') {
    return { node: <CircleDashed {...iconProps} />, tone: 'neutral' }
  }
  if (type === 'backlog') {
    return { node: <Tray {...iconProps} />, tone: 'backlog' }
  }
  if (type === 'triage' || name.includes('triage')) {
    return { node: <CircleDashed {...iconProps} />, tone: 'triage' }
  }
  if (state) {
    return { node: <Circle {...iconProps} />, tone: 'neutral' }
  }
  return { node: null, tone: 'neutral' }
}

export function StateGlyph({
  state,
  variant = 'inline',
  showTooltip,
  size,
}: StateGlyphProps) {
  const resolvedSize = size ?? (variant === 'icon' ? 14 : 16)
  const { node, tone } = resolveGlyph(state, resolvedSize)
  const label = state?.name ?? '—'
  const wantsTooltip = showTooltip ?? variant === 'icon'

  if (variant === 'icon') {
    const glyph = (
      <span
        className={styles.iconOnly}
        data-tone={tone}
        aria-hidden={wantsTooltip ? undefined : true}
      >
        {node}
      </span>
    )
    if (!wantsTooltip || !node) return glyph
    return <Tooltip label={label}>{glyph}</Tooltip>
  }

  return (
    <span className={styles.inline} data-tone={tone}>
      <span className={styles.icon}>{node}</span>
      <span className={styles.label}>{label}</span>
    </span>
  )
}
