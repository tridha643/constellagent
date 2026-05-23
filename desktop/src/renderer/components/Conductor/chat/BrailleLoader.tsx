import { useEffect, useState } from 'react'
import styles from '../Conductor.module.css'

const TICK_MS = 100
const PATTERN_SECONDS = 5

const BRAILLE_PATTERN_CLASSES = [
  styles.brailleGlyphWave,
  styles.brailleGlyphScan,
  styles.brailleGlyphPulse,
  styles.brailleGlyphRipple,
]

function formatElapsedSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

/** Conductor-style Braille motion + elapsed timer while a turn is in flight. */
export function BrailleLoader({
  startedAt,
  className,
}: {
  startedAt?: number | null
  className?: string
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const origin = startedAt ?? Date.now()
    const tick = () => setElapsed((Date.now() - origin) / 1000)
    tick()
    const id = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(id)
  }, [startedAt])

  const patternClass = BRAILLE_PATTERN_CLASSES[Math.floor(elapsed / PATTERN_SECONDS) % BRAILLE_PATTERN_CLASSES.length]

  return (
    <span className={`${styles.brailleLoader} ${className ?? ''}`} role="status" aria-live="polite">
      <span className={`${styles.brailleGlyph} ${patternClass}`} aria-hidden>
        ⠁⠂⠄⡀
      </span>
      <span className={styles.brailleElapsed}>{formatElapsedSeconds(elapsed)}</span>
    </span>
  )
}
