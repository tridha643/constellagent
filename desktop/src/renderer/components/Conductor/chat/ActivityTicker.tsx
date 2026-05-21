import { useEffect, useMemo, useState } from 'react'
import type { TimelineToolCall } from '../../../../shared/pi/timeline-types'
import { MarkdownBody } from './MarkdownBody'
import { BrailleLoader } from './BrailleLoader'
import styles from '../Conductor.module.css'

const ROW_HEIGHT = 40
const PLACEHOLDER_COUNT = 3

type Slot = { id: string; label: string } | null

/**
 * Slot-reel live activity: completed tools slide upward; labels render via ProseMark.
 */
export function ActivityTicker({
  items,
  running,
  startedAt,
  runningLabel,
}: {
  items: readonly TimelineToolCall[]
  running: boolean
  startedAt: number | null
  runningLabel?: string
}) {
  const done = !running

  const slots = useMemo<Slot[]>(() => {
    const leading: Slot[] = Array.from({ length: PLACEHOLDER_COUNT }, () => null)
    const trailing: Slot[] = done ? Array.from({ length: PLACEHOLDER_COUNT }, () => null) : []
    const real: Slot[] = items.map((item) => ({ id: item.id, label: item.label }))
    return [...leading, ...real, ...trailing]
  }, [items, done])

  const [visibleCount, setVisibleCount] = useState(0)

  useEffect(() => {
    if (visibleCount >= slots.length) return
    const id = window.setTimeout(
      () => setVisibleCount((count) => Math.min(count + 1, slots.length)),
      running ? 400 : 220,
    )
    return () => window.clearTimeout(id)
  }, [visibleCount, slots.length, running])

  useEffect(() => {
    if (visibleCount > slots.length) setVisibleCount(slots.length)
  }, [slots.length, visibleCount])

  const translateY = visibleCount < 2 ? 0 : -((visibleCount - 2) * ROW_HEIGHT - 8)
  const revealed = slots.slice(0, visibleCount)

  return (
    <div className={styles.ticker}>
      <div className={styles.tickerViewport}>
        <div
          className={styles.tickerTrack}
          style={{ transform: `translateY(${translateY}px)` }}
        >
          {revealed.map((slot, index) =>
            slot ? (
              <div key={slot.id} className={styles.tickerRow}>
                <MarkdownBody content={slot.label} className={styles.tickerRowMarkdown} compact inline />
              </div>
            ) : (
              <div key={`placeholder-${index}`} className={styles.tickerRow} aria-hidden />
            ),
          )}
        </div>
      </div>
      {running && (
        <div className={styles.tickerStatus}>
          <BrailleLoader startedAt={startedAt} />
          {runningLabel ? (
            <MarkdownBody
              content={runningLabel}
              className={styles.tickerStatusLabel}
              compact
              inline
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
