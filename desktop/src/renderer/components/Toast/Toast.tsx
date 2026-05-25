import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../../store/app-store'
import type { Toast } from '../../store/types'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import styles from './Toast.module.css'

const EXIT_MS = 140
const AUTO_DISMISS_MS = 5000

// Swipe gesture tuning (Emil Kowalski's swipe-to-dismiss model).
const DRAG_THRESHOLD_PX = 4 // movement under this is treated as a click, not a drag
const DISMISS_DISTANCE_PX = 80 // past this, release dismisses regardless of speed
const DISMISS_VELOCITY = 0.11 // px/ms — a fast flick dismisses even if short
const LEFT_RESISTANCE = 3 // wrong-way (leftward) drag is divided by this so it feels bounded
const SNAP_BACK_MS = 200 // eased return when a drag doesn't cross the dismiss threshold

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useAppStore((s) => s.dismissToast)
  const [visible, setVisible] = useState(true)
  const [entered, setEntered] = useState(false)
  const { shouldRender, animating } = useExitAnimation(visible, EXIT_MS)
  const [hovered, setHovered] = useState(false)
  const [documentHidden, setDocumentHidden] = useState(() => document.hidden)
  const timerRef = useRef<number | null>(null)
  const remainingRef = useRef(AUTO_DISMISS_MS)
  const startedAtRef = useRef(0)

  // Element + gesture state. We mutate the DOM directly during a drag so the
  // toast follows the pointer 1:1 without a React re-render on every move.
  const elRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const movedRef = useRef(false) // crossed DRAG_THRESHOLD_PX → it's a drag, not a tap
  const startXRef = useRef(0)
  const startTimeRef = useRef(0)
  const lastDxRef = useRef(0)
  const activePointerRef = useRef<number | null>(null)

  const clearDismissTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startExit = useCallback(() => {
    if (!visible) return
    clearDismissTimer()
    setVisible(false)
  }, [clearDismissTimer, visible])

  const pauseDismiss = useCallback(() => {
    if (!visible || timerRef.current === null) return
    const elapsed = Date.now() - startedAtRef.current
    remainingRef.current = Math.max(0, remainingRef.current - elapsed)
    clearDismissTimer()
  }, [clearDismissTimer, visible])

  const resumeDismiss = useCallback(() => {
    if (!visible) return
    clearDismissTimer()
    if (remainingRef.current <= 0) {
      startExit()
      return
    }

    startedAtRef.current = Date.now()
    timerRef.current = window.setTimeout(() => {
      remainingRef.current = 0
      startExit()
    }, remainingRef.current)
  }, [clearDismissTimer, visible, startExit])

  // Remove every inline style the drag wrote, so it never leaks past a
  // snap-back or a dismissal (an inline transform would otherwise override the
  // CSS exit animation's translateX/opacity).
  const clearInlineDragStyles = useCallback(() => {
    const el = elRef.current
    if (!el) return
    el.style.transform = ''
    el.style.opacity = ''
    el.style.transition = ''
    el.classList.remove(styles.dragging)
  }, [])

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (!shouldRender) {
      dismissToast(toast.id)
    }
  }, [shouldRender, dismissToast, toast.id])

  useEffect(() => {
    const handleVisibility = () => setDocumentHidden(document.hidden)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    if (hovered || documentHidden) pauseDismiss()
    else resumeDismiss()
  }, [documentHidden, hovered, pauseDismiss, resumeDismiss])

  useEffect(() => () => {
    clearDismissTimer()
  }, [clearDismissTimer])

  const prefersReducedMotion = useCallback(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Mouse: left button only. Touch/pen have button === 0 on primary contact.
      if (e.button !== 0) return
      // Ignore presses on the action button so it keeps its own click handling.
      if ((e.target as HTMLElement).closest(`.${styles.actionBtn}`)) return

      const el = elRef.current
      if (!el) return

      draggingRef.current = true
      movedRef.current = false
      startXRef.current = e.clientX
      startTimeRef.current = e.timeStamp || Date.now()
      lastDxRef.current = 0
      activePointerRef.current = e.pointerId

      // Capture so we keep getting move/up even if the pointer leaves the toast.
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // setPointerCapture can throw if the pointer is already gone; ignore.
      }

      // Pause the auto-dismiss countdown while a finger is down, mirroring the
      // hover-pause contract. resumeDismiss runs again on snap-back.
      pauseDismiss()
    },
    [pauseDismiss],
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || e.pointerId !== activePointerRef.current) return
    const el = elRef.current
    if (!el) return

    const rawDx = e.clientX - startXRef.current
    lastDxRef.current = rawDx

    if (!movedRef.current && Math.abs(rawDx) > DRAG_THRESHOLD_PX) {
      movedRef.current = true
      // Disable the base transition so the toast tracks the pointer 1:1.
      // Skip the live-follow visuals entirely under reduced motion.
      if (!prefersReducedMotion()) el.classList.add(styles.dragging)
    }

    if (!movedRef.current || prefersReducedMotion()) return

    // Rightward (toward dismissal) follows the finger; leftward is resisted.
    const dx = rawDx > 0 ? rawDx : rawDx / LEFT_RESISTANCE
    el.style.transform = `translateX(${dx}px)`
    // Fade out proportionally as it approaches the dismiss distance.
    const fade = Math.min(Math.abs(dx) / (DISMISS_DISTANCE_PX * 2), 0.6)
    el.style.opacity = String(1 - fade)
  }, [prefersReducedMotion])

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || e.pointerId !== activePointerRef.current) return
      draggingRef.current = false
      activePointerRef.current = null

      const el = elRef.current
      const dx = lastDxRef.current
      const moved = movedRef.current

      try {
        el?.releasePointerCapture(e.pointerId)
      } catch {
        // Already released / pointer gone — safe to ignore.
      }

      // Didn't move past the threshold → treat as a click/tap dismissal,
      // preserving the original onClick behavior without double-dismissing.
      if (!moved) {
        clearInlineDragStyles()
        startExit()
        return
      }

      const elapsed = Math.max(1, (e.timeStamp || Date.now()) - startTimeRef.current)
      const velocity = Math.abs(dx) / elapsed
      // Only a rightward (dismissal-direction) swipe should count toward the
      // distance threshold; a resisted leftward drag should snap back. Velocity
      // flicks count in the dismissal direction too.
      const shouldDismiss =
        (dx > 0 && Math.abs(dx) > DISMISS_DISTANCE_PX) || (dx > 0 && velocity > DISMISS_VELOCITY)

      if (shouldDismiss) {
        // Drop the inline transform so the CSS exit animation (translateX(14px))
        // owns the slide-out cleanly.
        clearInlineDragStyles()
        startExit()
        return
      }

      // Snap back. Under reduced motion just reset instantly (no live transform
      // was applied anyway). Otherwise add a brief eased transition, then strip
      // it once it has settled so it can't interfere with later animations.
      if (prefersReducedMotion()) {
        clearInlineDragStyles()
      } else if (el) {
        el.classList.remove(styles.dragging)
        el.style.transition = `transform ${SNAP_BACK_MS}ms var(--ease-out), opacity ${SNAP_BACK_MS}ms var(--ease-out)`
        el.style.transform = 'translateX(0)'
        el.style.opacity = '1'
        window.setTimeout(() => {
          // Only clear if a new drag hasn't started in the meantime.
          if (!draggingRef.current) clearInlineDragStyles()
        }, SNAP_BACK_MS)
      }

      // Restart the auto-dismiss countdown unless the pointer left it hovered.
      resumeDismiss()
    },
    [clearInlineDragStyles, startExit, prefersReducedMotion, resumeDismiss],
  )

  if (!shouldRender) {
    return null
  }

  return (
    <div
      ref={elRef}
      className={`${styles.toast} ${styles[toast.type]}`}
      data-mounted={entered && animating !== 'exit'}
      data-exiting={animating === 'exit'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={styles.message}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={(e) => {
            e.stopPropagation()
            toast.action!.onClick()
            startExit()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  if (toasts.length === 0) return null

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
