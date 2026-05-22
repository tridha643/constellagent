import { useEffect, useRef, useState } from 'react'
import type { AgentProvider } from '../../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../../shared/conductor-thinking'
import { THINKING_LABELS, nextThinkingLevel } from '../../../../shared/conductor-thinking'
import { EffortBars } from './ConductorIcons'
import styles from '../Conductor.module.css'

export function EffortPill({
  provider,
  level,
  onChange,
}: {
  provider: AgentProvider
  level: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
}) {
  const [transitioning, setTransitioning] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    }
  }, [])

  const cycle = () => {
    setTransitioning(true)
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setTransitioning(false)
      timerRef.current = undefined
    }, 200)
    onChange(nextThinkingLevel(level, provider))
  }

  return (
    <button
      type="button"
      className={`${styles.composerChip} ${styles.composerChipWarm} ${styles.effortPill}`}
      data-effort={level}
      data-transitioning={transitioning ? 'true' : undefined}
      onClick={cycle}
      title="Cycle reasoning effort"
      aria-label={`Reasoning effort: ${THINKING_LABELS[level]}. Click to cycle.`}
    >
      <EffortBars level={level} size={14} className={styles.effortBars} />
      <span className={`${styles.effortLabel} ${transitioning ? styles.effortLabelTransitioning : ''}`}>
        {THINKING_LABELS[level]}
      </span>
    </button>
  )
}
