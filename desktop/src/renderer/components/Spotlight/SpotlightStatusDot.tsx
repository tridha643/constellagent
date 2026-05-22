import { useEffect, useRef, useState } from 'react'
import type { SpotlightState } from '../../../shared/spotlight-types'
import styles from './Spotlight.module.css'

interface Props {
  state: SpotlightState
  message?: string
  className?: string
}

/**
 * 8px filled circle next to the spotlighted workspace's name. Color encodes the
 * state machine; transitions (not keyframes) so rapid file edits retarget
 * smoothly instead of restarting from zero. `prefers-reduced-motion` collapses
 * all motion to instant — see Spotlight.module.css.
 */
export function SpotlightStatusDot({ state, message, className }: Props) {
  // One-shot wobble for blocked/error transitions. Track entry into the
  // state so re-renders while still in that state don't re-trigger it.
  const [wobble, setWobble] = useState(false)
  const prevState = useRef<SpotlightState>(state)
  useEffect(() => {
    if ((state === 'blocked' || state === 'error') && prevState.current !== state) {
      setWobble(true)
      const t = setTimeout(() => setWobble(false), 200)
      prevState.current = state
      return () => clearTimeout(t)
    }
    prevState.current = state
  }, [state])

  if (state === 'idle') return null

  return (
    <span
      className={[
        styles.dot,
        styles[`dot_${state}`],
        wobble ? styles.dotWobble : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      title={message ?? labelFor(state)}
      aria-label={`Spotlight: ${labelFor(state)}`}
    />
  )
}

function labelFor(state: SpotlightState): string {
  switch (state) {
    case 'preparing': return 'Preparing'
    case 'syncing': return 'Syncing root from workspace'
    case 'watching': return 'Watching workspace; root in sync'
    case 'restoring': return 'Restoring root'
    case 'blocked': return 'Blocked — finish or abort the rebase/merge'
    case 'error': return 'Spotlight error'
    default: return 'Spotlight idle'
  }
}
