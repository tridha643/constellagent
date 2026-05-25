import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** A focusable element is "visible" when it actually occupies layout space. */
function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible)
}

/**
 * Trap Tab / Shift+Tab focus inside an open modal/palette and restore focus to
 * whatever was focused before it opened once it closes.
 *
 * - Captures the previously-focused element once, when the trap becomes active.
 * - On Tab at the last element → wraps to first; Shift+Tab at the first → wraps
 *   to last; if focus has escaped the container it is pulled back inside.
 * - Does NOT steal focus when something inside is already focused (respects
 *   existing `autoFocus`); only focuses the first focusable when nothing inside
 *   currently holds focus.
 * - On cleanup restores focus to the captured element when it's still connected.
 *
 * Defensive: no-ops if the container ref is null or `document` is unavailable.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active = true,
): void {
  // Holds the element focused before the trap activated, so we can restore it.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    if (typeof document === 'undefined') return
    const container = containerRef.current
    if (!container) return

    // Capture the outside element once so close can hand focus back to it.
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null

    // Only claim focus if nothing inside the container already holds it — this
    // preserves the dialogs' existing autoFocus / programmatic focus behaviour.
    if (!container.contains(document.activeElement)) {
      const focusable = getFocusable(container)
      focusable[0]?.focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable(container)
      if (focusable.length === 0) {
        // Nothing to focus inside; keep focus from leaving the overlay anyway.
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeEl = document.activeElement as HTMLElement | null

      // Focus has escaped the container (e.g. into the obscured app behind the
      // overlay) — redirect it back to an appropriate edge.
      if (!activeEl || !container.contains(activeEl)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }

      if (e.shiftKey) {
        if (activeEl === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (activeEl === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      // Restore focus to the pre-open element when it's still in the DOM.
      const previous = previouslyFocusedRef.current
      previouslyFocusedRef.current = null
      if (previous && previous.isConnected && typeof previous.focus === 'function') {
        try {
          previous.focus()
        } catch {
          // Element may have become unfocusable between capture and restore.
        }
      }
    }
  }, [active, containerRef])
}
