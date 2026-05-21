import { useEffect, type RefObject } from 'react'
import type { ContextWindowData } from '../../../../shared/context-window-types'
import { useAppStore } from '../../../store/app-store'
import styles from '../Conductor.module.css'

export function formatContextTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

const RING_SIZE = 22
const STROKE = 2
const RADIUS = (RING_SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export const CONDUCTOR_CONTEXT_IDLE: ContextWindowData = {
  usedTokens: 0,
  contextWindowSize: 200_000,
  percentage: 0,
  model: '',
  sessionId: '',
  lastUpdated: 0,
}

export function useConductorContextUsage(): { data: ContextWindowData; idle: boolean } {
  const storeData = useAppStore((s) => s.contextWindowData)
  return {
    data: storeData ?? CONDUCTOR_CONTEXT_IDLE,
    idle: !storeData,
  }
}

export function ContextRingButton({
  percentage,
  open,
  onToggle,
}: {
  percentage: number
  open: boolean
  onToggle: () => void
}) {
  const pct = Math.min(100, Math.max(0, percentage))
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE

  return (
    <button
      type="button"
      className={`${styles.contextRingBtn} ${open ? styles.contextRingBtnOpen : ''}`}
      aria-label={`Context window ${pct}% used`}
      aria-expanded={open}
      title="Context window"
      onClick={onToggle}
    >
      <svg
        className={styles.contextRingSvg}
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden
      >
        <circle
          className={styles.contextRingTrack}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
        />
        <circle
          className={styles.contextRingArc}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
    </button>
  )
}

export function ContextPanel({
  data,
  idle,
  modelLabel,
}: {
  data: ContextWindowData
  idle: boolean
  modelLabel: string
}) {
  const usedLabel = formatContextTokens(data.usedTokens)
  const totalLabel = formatContextTokens(data.contextWindowSize)
  const pct = Math.min(100, Math.max(0, data.percentage))

  return (
    <div
      className={styles.contextPanel}
      role="region"
      aria-label="Context window usage"
      data-conductor-context-panel
    >
      <div className={styles.contextPanelHeader}>
        <span className={styles.contextPanelTitle}>Context</span>
        <span className={styles.contextPanelCounts}>
          {usedLabel}/{totalLabel}
        </span>
      </div>
      <div className={styles.contextPanelBarTrack} aria-hidden>
        <div className={styles.contextPanelBarFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.contextPanelFooter}>
        <span className={styles.contextPanelLabel}>Window used</span>
        <span className={styles.contextPanelPct}>{pct.toFixed(1)}%</span>
      </div>
      {idle && (
        <p className={styles.contextPanelHint}>
          Live usage for {modelLabel} sessions isn&apos;t wired yet — showing last known or empty window.
        </p>
      )}
    </div>
  )
}

/** Click-outside / Escape to close the in-composer context panel. */
export function useContextPanelDismiss(open: boolean, onClose: () => void, exceptRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (exceptRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, exceptRef])
}
