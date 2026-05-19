import { useEffect, useState } from 'react'
import styles from './Spotlight.module.css'

export interface SpotlightToastProps {
  message: string
  action?: { label: string; onClick: () => void }
  onDismiss: () => void
  /** Auto-dismiss delay in ms. Default 3000. */
  durationMs?: number
}

/**
 * Bottom-right toast for Spotlight state transitions. Enter slides up + fade
 * over 240ms; exit slides down + fade over 180ms (exit faster than enter —
 * Emil rule). Auto-dismisses after `durationMs`, also dismissable.
 */
export function SpotlightToast({ message, action, onDismiss, durationMs = 3000 }: SpotlightToastProps) {
  const [phase, setPhase] = useState<'entering' | 'visible' | 'exiting'>('entering')

  useEffect(() => {
    // Trigger transition off the entering state after first paint so the
    // browser actually animates from the starting style to the visible one.
    const raf = requestAnimationFrame(() => setPhase('visible'))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (phase !== 'visible') return
    const t = setTimeout(() => handleDismiss(), durationMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const handleDismiss = () => {
    setPhase('exiting')
    setTimeout(onDismiss, 180)
  }

  return (
    <div
      role="status"
      className={[
        styles.toast,
        phase === 'entering' ? styles.toastEntering : '',
        phase === 'exiting' ? styles.toastExiting : '',
      ].filter(Boolean).join(' ')}
    >
      <span className={styles.toastMessage}>{message}</span>
      {action && (
        <button
          type="button"
          className={styles.toastAction}
          onClick={() => {
            action.onClick()
            handleDismiss()
          }}
        >
          {action.label}
        </button>
      )}
      <button type="button" className={styles.toastDismiss} onClick={handleDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
