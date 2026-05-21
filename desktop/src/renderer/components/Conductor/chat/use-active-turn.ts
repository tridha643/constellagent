import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ConductorTurn } from '../../../../shared/conductor-transcript-utils'

/** Match writer `EDITOR_SAFE_SCROLL_MARGIN` + fudge for turn activation. */
const ACTIVE_OFFSET_PX = 16

export function useActiveTurnIndex(
  scrollContainerRef: RefObject<HTMLElement | null>,
  turns: readonly ConductorTurn[],
): number {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef(activeIndex)
  activeRef.current = activeIndex

  useEffect(() => {
    const scroller = scrollContainerRef.current
    if (!scroller || turns.length === 0) {
      if (activeRef.current !== 0) setActiveIndex(0)
      return
    }

    let frame = 0
    const update = () => {
      frame = 0
      const rect = scroller.getBoundingClientRect()
      const threshold = rect.top + ACTIVE_OFFSET_PX
      let next = 0
      for (let i = 0; i < turns.length; i++) {
        const el = scroller.querySelector(`[data-message-id="${turns[i].userMessageId}"]`)
        if (!(el instanceof HTMLElement)) continue
        if (el.getBoundingClientRect().top > threshold) break
        next = i
      }
      if (activeRef.current !== next) setActiveIndex(next)
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }

    update()
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [scrollContainerRef, turns])

  return turns.length === 0 ? 0 : activeIndex
}

export function useMountTransition(active: boolean, durationMs: number): {
  shouldRender: boolean
  phase: 'open' | 'closed'
} {
  const [shouldRender, setShouldRender] = useState(false)
  const [phase, setPhase] = useState<'open' | 'closed'>('closed')

  useEffect(() => {
    if (active) {
      setShouldRender(true)
      const frame = requestAnimationFrame(() => setPhase('open'))
      return () => cancelAnimationFrame(frame)
    }
    setPhase('closed')
    const timer = window.setTimeout(() => setShouldRender(false), durationMs)
    return () => clearTimeout(timer)
  }, [active, durationMs])

  return { shouldRender, phase }
}
