/**
 * Pure geometry for the sliding tab indicator (rudu `Tabs.Indicator` port).
 *
 * Kept separate from the React component so the measurement math is unit-testable
 * without a DOM (renderer tests run under plain `bun:test`, no jsdom).
 */

export interface TabBox {
  /** Offset of the tab from the track's padding box, in px (button.offsetLeft). */
  offsetLeft: number
  /** Rendered width of the tab, in px (button.offsetWidth). */
  offsetWidth: number
}

export interface IndicatorMetrics {
  /** translateX applied to the indicator pill, in px. */
  x: number
  /** Width of the indicator pill, in px. */
  width: number
}

/**
 * Compute the indicator pill position/size for the active tab.
 * Returns `null` when there is nothing to point at (empty list or the active
 * index is out of range) so the caller can keep the indicator hidden.
 */
export function indicatorMetrics(
  boxes: readonly TabBox[],
  activeIndex: number,
): IndicatorMetrics | null {
  if (activeIndex < 0 || activeIndex >= boxes.length) return null
  const box = boxes[activeIndex]
  if (!box) return null
  // Clamp to non-negative; a detached/zero-size button must not yield NaN.
  const x = Number.isFinite(box.offsetLeft) ? box.offsetLeft : 0
  const width = Number.isFinite(box.offsetWidth) ? Math.max(0, box.offsetWidth) : 0
  return { x, width }
}
