import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * Position a popover in the viewport with `position: fixed` so it is not clipped by
 * ancestors with `overflow: hidden` (e.g. rounded composer cards).
 */
export function useFixedPopoverStyle(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  options?: { gapPx?: number; minWidthPx?: number },
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined)
  const gapPx = options?.gapPx ?? 6
  const minWidthPx = options?.minWidthPx ?? 280

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined)
      return
    }

    const anchor = anchorRef.current
    if (!anchor) return

    const update = (): void => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setStyle({
        position: 'fixed',
        left: r.left,
        top: r.bottom + gapPx,
        minWidth: Math.max(minWidthPx, Math.ceil(r.width)),
        maxWidth: 'min(360px, 92vw)',
        zIndex: 100_000,
      })
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(anchor)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, anchorRef, gapPx, minWidthPx])

  return style
}
