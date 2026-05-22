import { useEffect, useRef, useState } from 'react'
import type { AgentProvider } from '../../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../../shared/conductor-thinking'
import {
  THINKING_LABELS,
  isReasoningEffortActive,
  nextThinkingLevel,
} from '../../../../shared/conductor-thinking'
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

  const reasoningActive = isReasoningEffortActive(level)
  const showEffortState = level !== 'minimal'
  const chipClass = showEffortState ? styles.composerChipWarm : styles.composerChipNeutral

  return (
    <button
      type="button"
      className={[
        styles.composerChip,
        chipClass,
        styles.effortPill,
        showEffortState ? '' : styles.effortPillIconOnly,
      ]
        .filter(Boolean)
        .join(' ')}
      data-effort={level}
      data-reasoning-active={reasoningActive ? 'true' : undefined}
      data-transitioning={transitioning ? 'true' : undefined}
      onClick={cycle}
      title={`Reasoning: ${THINKING_LABELS[level]}. Click to cycle.`}
      aria-label={`Reasoning effort: ${THINKING_LABELS[level]}. Click to cycle.`}
    >
      <EffortBars level={level} size={14} className={styles.effortBars} />
      {showEffortState ? (
        <span className={`${styles.effortLabel} ${transitioning ? styles.effortLabelTransitioning : ''}`}>
          {THINKING_LABELS[level]}
        </span>
      ) : null}
    </button>
  )
}
