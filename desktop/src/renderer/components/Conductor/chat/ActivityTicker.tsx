import { useEffect, useMemo, useState } from 'react'
import type { TimelineToolCall } from '../../../../shared/pi/timeline-types'
import { MuloadLoader } from './MuloadLoader'
import { ToolPart } from './tools/tool-registry'
import styles from '../Conductor.module.css'

const LONG_RUN_HINT_MS = 20_000

function isShellTool(tool: TimelineToolCall): boolean {
  const name = tool.toolName.toLowerCase()
  return name === 'shell' || name === 'bash' || name === 'command_execution'
}

/**
 * Live activity: compact tool chip for the active call; completed tools fade without scale pop-in.
 */
export function ActivityTicker({
  items,
  activeTool,
  running,
  startedAt,
  runningLabel,
}: {
  items: readonly TimelineToolCall[]
  activeTool?: TimelineToolCall
  running: boolean
  startedAt: number | null
  runningLabel?: string
}) {
  const lastCompleted = items.length > 0 ? items[items.length - 1] : undefined
  const chipKey = activeTool?.id ?? lastCompleted?.id ?? 'idle'

  const chipContent = useMemo(() => {
    if (activeTool) return <ToolPart tool={activeTool} />
    if (lastCompleted) return <ToolPart tool={lastCompleted} />
    return null
  }, [activeTool, lastCompleted])

  const [showLongRunHint, setShowLongRunHint] = useState(false)
  useEffect(() => {
    if (!running || !startedAt) {
      setShowLongRunHint(false)
      return
    }
    const elapsed = Date.now() - startedAt
    if (elapsed >= LONG_RUN_HINT_MS) {
      setShowLongRunHint(true)
      return
    }
    const timer = setTimeout(() => setShowLongRunHint(true), LONG_RUN_HINT_MS - elapsed)
    return () => clearTimeout(timer)
  }, [running, startedAt, activeTool?.id])

  const longRunHint =
    showLongRunHint && running && (activeTool ? isShellTool(activeTool) : true)

  return (
    <div className={styles.ticker}>
      {chipContent ? (
        <div key={chipKey} className={`${styles.tickerRow} ${styles.tickerRowChip}`}>
          {chipContent}
        </div>
      ) : null}
      {running && (
        <div className={styles.tickerStatus}>
          <MuloadLoader startedAt={startedAt} />
          {longRunHint ? (
            <span className={styles.longRunHint}>Still running — Esc to stop</span>
          ) : runningLabel && !activeTool ? (
            <span className={styles.tickerStatusLabel}>{runningLabel}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}
