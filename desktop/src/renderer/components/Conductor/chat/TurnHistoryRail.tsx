import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { TranscriptMessage } from '../../../../shared/pi/pi-desktop-state'
import { groupTranscriptIntoTurns } from '../../../../shared/conductor-transcript-utils'
import { PlanMapIcon } from './ConductorIcons'
import styles from '../Conductor.module.css'

const RAIL_INSET = 12
const ACTIVE_WIDTH = 20
const RAIL_ZONE_WIDTH = RAIL_INSET + ACTIVE_WIDTH + 2
const POPOVER_WIDTH = 280

export interface TurnHistoryRailHandle {
  open: () => void
}

/** Edge rail + floating turn list — writer-computer SectionRail pattern for chat history. */
export const TurnHistoryRail = forwardRef<
  TurnHistoryRailHandle,
  {
    transcript: readonly TranscriptMessage[]
    scrollContainerRef: RefObject<HTMLDivElement | null>
    onSelectTurn: (messageId: string, refillComposer: boolean) => void
  }
>(function TurnHistoryRail({ transcript, scrollContainerRef, onSelectTurn }, ref) {
  const turns = groupTranscriptIntoTurns(transcript)
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  const railZoneRef = useRef<HTMLDivElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useImperativeHandle(ref, () => ({
    open: () => {
      setInstant(true)
      setOpen(true)
    },
  }))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const handleRailLeave = (event: React.MouseEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && popoverRef.current?.contains(next)) return
    setOpen(false)
  }

  const handlePopoverLeave = (event: React.MouseEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && railZoneRef.current?.contains(next)) return
    setOpen(false)
  }

  const scrollToTurn = useCallback(
    (messageId: string) => {
      const scroller = scrollContainerRef.current
      if (!scroller) return
      const target = scroller.querySelector(`[data-message-id="${messageId}"]`)
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    },
    [scrollContainerRef],
  )

  if (turns.length === 0) return null

  const activeIndex = turns.length - 1

  return (
    <div
      className={styles.turnRailHost}
      style={{ width: RAIL_INSET + POPOVER_WIDTH }}
      aria-hidden={!open}
    >
      <div
        ref={railZoneRef}
        className={styles.turnRailZone}
        style={{ width: RAIL_ZONE_WIDTH }}
        onMouseEnter={() => {
          setInstant(false)
          setOpen(true)
        }}
        onMouseLeave={handleRailLeave}
      >
        <div
          className={styles.turnRailTicks}
          data-open={open ? 'true' : 'false'}
          role="navigation"
          aria-label="Chat turns"
        >
          {turns.map((turn, i) => {
            const isActive = i === activeIndex
            return (
              <button
                key={turn.userMessageId}
                type="button"
                className={styles.turnRailTick}
                data-active={isActive || undefined}
                title={turn.userText}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => scrollToTurn(turn.userMessageId)}
              />
            )
          })}
        </div>
      </div>

      <div
        ref={popoverRef}
        className={styles.turnRailPopover}
        data-state={open ? 'open' : 'closed'}
        data-instant={instant || undefined}
        role="menu"
        aria-label="Previous messages"
        onMouseEnter={() => {
          setInstant(false)
          setOpen(true)
        }}
        onMouseLeave={handlePopoverLeave}
      >
        <div className={styles.turnRailPopoverScroll}>
          <ul className={styles.turnRailPopoverList}>
            {[...turns].reverse().map((turn) => (
              <li key={turn.userMessageId}>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.turnRailPopoverRow}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    onSelectTurn(turn.userMessageId, e.shiftKey)
                    scrollToTurn(turn.userMessageId)
                    setOpen(false)
                  }}
                >
                  <span className={styles.turnRailPopoverUser}>
                    {turn.plan ? (
                      <span className={styles.historyItemMode} aria-label="Plan mode">
                        <PlanMapIcon size={13} />
                      </span>
                    ) : null}
                    {turn.userText}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
})
