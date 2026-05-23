import type { AgentProvider } from '../../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../../shared/conductor-thinking'
import { CursorIcon } from '../../Icons/CursorIcon'
import openaiIcon from '../../../assets/agent-icons/openai.svg'

const STROKE = 1.75

export function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Branch chat from here — trunk up, two paths diverge, arrows at each tip. */
export function ForkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20V10" />
      <path d="M12 10 6 5" />
      <path d="M12 10 18 5" />
      <path d="M10 18 12 20 14 18" />
      <path d="M8.3 5.4 6 5 7.5 7.2" />
      <path d="M15.5 7.2 18 5 16.7 5.4" />
    </svg>
  )
}

/** Thin upward arrow for composer send (rounded-square primary action). */
export function ComposerSendIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none">
      <path d="M10 14.5V6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.65" />
      <path
        d="M5.85 9.35 10 5.2 14.15 9.35"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.65"
      />
    </svg>
  )
}

/** Rounded square for composer stop — same shell as send. */
export function ComposerStopIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none">
      <rect x="5.2" y="5.2" width="9.6" height="9.6" rx="1.6" fill="currentColor" />
    </svg>
  )
}

/** Three-panel folded map for plan mode. */
export function PlanMapIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <path d="M3 6.5 9 4.5v13L3 19.5V6.5Z" strokeLinejoin="round" />
      <path d="M9 4.5 15 6.5v13L9 17.5V4.5Z" strokeLinejoin="round" />
      <path d="M15 6.5 21 4.5v13l-6 2V6.5Z" strokeLinejoin="round" />
    </svg>
  )
}

/** Layout grid for canvas mode. */
export function CanvasGridIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  )
}

/** Brain/loop motif for reasoning effort cycling. */
export function ReasoningIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M7.2 6.1a2.6 2.6 0 1 1 2.6 2.6v1.05M12.35 6.35a2.2 2.2 0 1 1-2.2-2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path d="M7.2 13.6h5.6M8.2 16h3.6" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  )
}

const BAR_HEIGHTS = [4, 7, 10, 13]

export function EffortBars({
  level,
  size = 14,
  className,
}: {
  level: ThinkingLevel
  size?: number
  className?: string
}) {
  const activeCount = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4 }[level]
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      {BAR_HEIGHTS.map((h, i) => (
        <rect
          key={i}
          x={1 + i * 4}
          y={16 - h}
          width={2.5}
          height={h}
          rx={0.25}
          fill="currentColor"
          opacity={i < activeCount ? 1 : 0.25}
        />
      ))}
    </svg>
  )
}

/** Green “+” for diff addition counts (Conductor file-change header). */
export function DiffPlusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden>
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
    </svg>
  )
}

/** Red “−” for diff deletion counts (Conductor file-change header). */
export function DiffMinusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden>
      <path d="M3.5 8h9" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
    </svg>
  )
}

/** Pencil-on-line edit glyph for diff/file-change tool headers. */
export function EditIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <path d="M12 20h9" strokeLinecap="round" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevronDownIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Small bolt between model name and effort pill (Conductor reference). */
export function LightningIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" strokeLinejoin="round" />
    </svg>
  )
}

/** L-bracket corner glyph with three dots for subagent rows. */
export function SubagentCornerIcon({ size = 14, pulsing }: { size?: number; pulsing?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      className={pulsing ? 'subagentCornerPulse' : undefined}
    >
      <path d="M4 2v8h8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="4" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="4" cy="7" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="7" cy="10" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ProviderIcon({
  provider,
  size = 15,
  className,
}: {
  provider: AgentProvider
  size?: number
  className?: string
}) {
  if (provider === 'cursor') {
    return (
      <span className={className} style={{ width: size, height: size, display: 'inline-flex' }}>
        <CursorIcon className={className} />
      </span>
    )
  }
  return (
    <img
      src={openaiIcon}
      alt=""
      width={size}
      height={size}
      className={className}
      aria-hidden
      style={{ display: 'block', opacity: 0.85 }}
    />
  )
}
