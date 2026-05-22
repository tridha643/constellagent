import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useConductorChatTypographyScope } from '../useConductorChatTypographyScope'
import type { TranscriptMessage } from '../../../../shared/pi/pi-desktop-state'
import { groupTranscriptIntoTurns } from '../../../../shared/conductor-transcript-utils'
import { PlanMapIcon } from './ConductorIcons'
import { ScrollFade } from './ScrollFade'
import { useActiveTurnIndex, useMountTransition } from './use-active-turn'
import railStyles from './TurnHistoryRail.module.css'

const TICK_GAP = 6
const RAIL_INSET = 12
const RAIL_ZONE_WIDTH = RAIL_INSET + 22
const POPOVER_WIDTH = 260
/** Matches `--duration-exit` / `useMountTransition` unmount delay. */
const POPOVER_TRANSITION_MS = 140

export interface TurnHistoryRailHandle {
  open: () => void
}

/** Edge rail + floating turn list — writer.computer SectionRail (UI + behavior). */
export const TurnHistoryRail = forwardRef<
  TurnHistoryRailHandle,
  {
    transcript: readonly TranscriptMessage[]
    scrollContainerRef: RefObject<HTMLDivElement | null>
    onSelectTurn: (messageId: string, refillComposer: boolean) => void
  }
>(function TurnHistoryRail({ transcript, scrollContainerRef, onSelectTurn }, ref) {
  const turns = groupTranscriptIntoTurns(transcript)
  const activeIndex = useActiveTurnIndex(scrollContainerRef, turns)
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  const { shouldRender: showPopover, phase } = useMountTransition(open, POPOVER_TRANSITION_MS)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const railZoneRef = useRef<HTMLDivElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  useConductorChatTypographyScope(hostRef)

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

  return (
    <div
      ref={hostRef}
      className={railStyles.host}
      data-testid="conductor-turn-rail"
      style={{ width: RAIL_INSET + POPOVER_WIDTH }}
      aria-hidden={!open}
    >
      <div
        ref={railZoneRef}
        className={railStyles.zone}
        style={{ width: RAIL_ZONE_WIDTH }}
        onMouseEnter={() => {
          setInstant(false)
          setOpen(true)
        }}
        onMouseLeave={handleRailLeave}
      >
        <ScrollFade alwaysFade fadeSize="48px" className={railStyles.ticksScrollWrap}>
          <div
            className={railStyles.ticks}
            data-open={open ? 'true' : 'false'}
            style={{ gap: TICK_GAP }}
            role="navigation"
            aria-label="Chat turns"
          >
            {turns.map((turn, i) => {
              const isActive = i === activeIndex
              return (
                <button
                  key={turn.userMessageId}
                  type="button"
                  className={railStyles.tick}
                  data-active={isActive || undefined}
                  title={turn.userText}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => scrollToTurn(turn.userMessageId)}
                />
              )
            })}
          </div>
        </ScrollFade>
      </div>

      {showPopover ? (
        <div
          ref={popoverRef}
          className={`${railStyles.surfaceCard} ${railStyles.popover}`}
          data-state={instant ? 'open' : phase}
          data-instant={instant || undefined}
          role="menu"
          aria-label="Previous messages"
          onMouseEnter={() => {
            setInstant(false)
            setOpen(true)
          }}
          onMouseLeave={handlePopoverLeave}
        >
          <ScrollFade axis="vertical" fadeSize="20px" className={railStyles.popoverScroll}>
            <ul className={railStyles.popoverList}>
              {turns.map((turn, i) => {
                const isActive = i === activeIndex
                return (
                  <li key={turn.userMessageId}>
                    <button
                      type="button"
                      role="menuitem"
                      className={`${railStyles.popoverRow}${isActive ? ` ${railStyles.popoverRowActive}` : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        onSelectTurn(turn.userMessageId, e.shiftKey)
                        scrollToTurn(turn.userMessageId)
                        setOpen(false)
                      }}
                    >
                      {turn.plan ? (
                        <span className={railStyles.planIcon} aria-label="Plan mode">
                          <PlanMapIcon size={13} />
                        </span>
                      ) : null}
                      <span className={railStyles.popoverLabel}>{turn.userText}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </ScrollFade>
        </div>
      ) : null}
    </div>
  )
})
