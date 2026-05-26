import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { AgentProvider, QueuedAgentMessage } from '../../../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../../../shared/conductor-attachments'
import type { ContextWindowData } from '../../../../shared/context-window-types'
import type { TranscriptMessage } from '../../../../shared/pi/pi-desktop-state'
import type { UsageLimitWindow, UsageLimitsData } from '../../../../shared/usage-limits-types'
import {
  formatLimitResetAt,
  percentLeft,
} from '../../../../shared/usage-limits-format'
import { useConductorUsageLimits, useUsageLimitsPoller } from '../../../hooks/useUsageLimitsPoller'
import { useConductorContextUsage } from '../../../hooks/useConductorContextUsage'
import { CONDUCTOR_CONTEXT_IDLE } from '../../../../shared/context-window-utils'
import styles from '../Conductor.module.css'

export { CONDUCTOR_CONTEXT_IDLE }

export function formatContextTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

const ICON_RADIUS = 6.5
const ICON_VIEWBOX = 16
const ICON_CENTER = 8
const ICON_STROKE_WIDTH = 1.5

const SHOW_DELAY = 200
const HIDE_DELAY = 150
const SKIP_WINDOW = 500
const POPOVER_GAP = 8
const EDGE_PAD = 8

let lastPopoverHidden = 0

function ContextUsageIcon({
  usedTokens,
  maxTokens,
}: {
  usedTokens: number
  maxTokens: number
}) {
  const circumference = 2 * Math.PI * ICON_RADIUS
  const usedPercent = Math.min(usedTokens / Math.max(maxTokens, 1), 1)
  const dashOffset = circumference * (1 - usedPercent)

  return (
    <svg
      aria-label="Model context usage"
      className={styles.contextUsageIcon}
      height={ICON_VIEWBOX}
      role="img"
      style={{ color: 'currentcolor' }}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width={ICON_VIEWBOX}
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        className={styles.contextUsageIconArc}
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transformBox: 'fill-box', transformOrigin: 'center', transform: 'rotate(-90deg)' }}
      />
    </svg>
  )
}

function LimitSection({ window: limit }: { window: UsageLimitWindow }) {
  const left = percentLeft(limit.usedPercent)
  const resetLabel = formatLimitResetAt(limit.resetsAtMs)

  return (
    <div className={styles.contextPopoverLimit}>
      <div className={styles.contextPopoverLimitHeader}>
        <span className={styles.contextPopoverLimitLabel}>{limit.label} limit</span>
        <span className={styles.contextPopoverLimitPct}>{left.toFixed(0)}% left</span>
      </div>
      <div className={styles.contextPopoverBarTrack} aria-hidden>
        <div className={styles.contextPopoverBarFill} style={{ transform: `scaleX(${left / 100})` }} />
      </div>
      {resetLabel ? (
        <p className={styles.contextPopoverReset}>Resets {resetLabel}</p>
      ) : null}
    </div>
  )
}

function ContextUsagePopoverContent({
  data,
  idle,
  limits,
}: {
  data: ContextWindowData
  idle: boolean
  limits: UsageLimitsData | null
}) {
  const usedLabel = formatContextTokens(data.usedTokens)
  const totalLabel = formatContextTokens(data.contextWindowSize)
  const pct = Math.min(100, Math.max(0, data.percentage))
  const limitRows = [limits?.primary, limits?.secondary].filter(
    (row): row is UsageLimitWindow => row != null,
  )

  return (
    <div className={styles.contextPopover} role="tooltip" aria-label="Context and usage limits">
      <div className={styles.contextPopoverSection}>
        <div className={styles.contextPopoverHeader}>
          <span className={styles.contextPopoverTitle}>Context</span>
          <span className={styles.contextPopoverCounts}>
            {usedLabel}/{totalLabel}
          </span>
        </div>
        <div className={styles.contextPopoverBarTrack} aria-hidden>
          <div className={styles.contextPopoverBarFill} style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <div className={styles.contextPopoverFooter}>
          <span className={styles.contextPopoverLabel}>Window used</span>
          <span className={styles.contextPopoverPct}>{pct.toFixed(1)}%</span>
        </div>
      </div>

      {limitRows.length > 0 ? (
        <>
          <div className={styles.contextPopoverDivider} aria-hidden />
          {limitRows.map((row) => (
            <LimitSection key={row.label} window={row} />
          ))}
        </>
      ) : null}

      {idle ? (
        <p className={styles.contextPopoverHint}>
          Start a chat to track context window usage for this session.
        </p>
      ) : null}
    </div>
  )
}

export function ContextUsageHover({
  provider,
  sessionId,
  model,
  transcript,
  queuedMessages,
  draftText,
  draftAttachments,
}: {
  provider: AgentProvider
  sessionId: string | null
  model: string
  transcript?: readonly TranscriptMessage[]
  queuedMessages?: readonly QueuedAgentMessage[]
  draftText?: string
  draftAttachments?: readonly ConductorComposerAttachment[]
}) {
  const { data, idle } = useConductorContextUsage(sessionId, {
    model,
    transcript,
    queuedMessages,
    draftText,
    draftAttachments,
  })
  useUsageLimitsPoller(provider)
  const { data: limits } = useConductorUsageLimits()

  const [visible, setVisible] = useState(false)
  const [entered, setEntered] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0, bottom: 0 })
  const wrapperRef = useRef<HTMLSpanElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hoveringRef = useRef(false)

  const pct = Math.min(100, Math.max(0, data.percentage))

  const clearTimers = useCallback(() => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
  }, [])

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!hoveringRef.current) {
        if (visible) lastPopoverHidden = Date.now()
        setEntered(false)
        setVisible(false)
      }
    }, HIDE_DELAY)
  }, [visible])

  const show = useCallback(() => {
    clearTimeout(hideTimer.current)
    const shouldOpenInstantly = Date.now() - lastPopoverHidden < SKIP_WINDOW
    const delay = shouldOpenInstantly ? 0 : SHOW_DELAY

    showTimer.current = setTimeout(() => {
      const el = wrapperRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      setCoords({
        x: rect.left + rect.width / 2,
        y: rect.top - POPOVER_GAP,
        bottom: rect.bottom,
      })
      setEntered(false)
      setVisible(true)
    }, delay)
  }, [])

  const onEnter = useCallback(() => {
    hoveringRef.current = true
    clearTimers()
    show()
  }, [clearTimers, show])

  const onLeave = useCallback(() => {
    hoveringRef.current = false
    clearTimeout(showTimer.current)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => () => clearTimers(), [clearTimers])

  useLayoutEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [visible, coords.x, coords.y])

  useLayoutEffect(() => {
    if (!visible || !popoverRef.current) return
    const tip = popoverRef.current
    const rect = tip.getBoundingClientRect()
    if (rect.left < EDGE_PAD) {
      tip.style.left = `${coords.x + (EDGE_PAD - rect.left)}px`
    } else if (rect.right > window.innerWidth - EDGE_PAD) {
      tip.style.left = `${coords.x - (rect.right - window.innerWidth + EDGE_PAD)}px`
    }
  }, [visible, coords.x])

  return (
    <>
      <span
        ref={wrapperRef}
        className={styles.contextRingWrap}
        data-testid="conductor-context-ring"
        aria-label={`Context window ${pct}% used`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <ContextUsageIcon
          usedTokens={data.usedTokens}
          maxTokens={data.contextWindowSize}
        />
      </span>
      {visible
        ? createPortal(
            <div
              ref={popoverRef}
              className={styles.contextPopoverPortal}
              data-testid="conductor-context-popover"
              style={{
                left: coords.x,
                top: coords.y,
              }}
              data-entered={entered}
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
            >
              <ContextUsagePopoverContent
                data={data}
                idle={idle}
                limits={limits}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
