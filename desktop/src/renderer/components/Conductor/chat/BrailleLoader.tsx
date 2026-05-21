import { useEffect, useState } from 'react'
import styles from '../Conductor.module.css'

/** Classic Braille spinner frames (Unicode block U+2800). */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const FRAME_MS = 80
const TICK_MS = 100

function formatElapsedSeconds(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

/** Conductor-style Braille motion + elapsed timer while a turn is in flight. */
export function BrailleLoader({
  startedAt,
  className,
}: {
  startedAt?: number | null
  className?: string
}) {
  const [frame, setFrame] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length)
    }, FRAME_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const origin = startedAt ?? Date.now()
    const tick = () => setElapsed((Date.now() - origin) / 1000)
    tick()
    const id = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(id)
  }, [startedAt])

  return (
    <span className={`${styles.brailleLoader} ${className ?? ''}`} role="status" aria-live="polite">
      <span className={styles.brailleGlyph} aria-hidden>
        {FRAMES[frame]}
      </span>
      <span className={styles.brailleElapsed}>{formatElapsedSeconds(elapsed)}</span>
    </span>
  )
}
