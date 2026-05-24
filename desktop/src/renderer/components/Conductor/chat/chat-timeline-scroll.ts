export const CHAT_TIMELINE_NEAR_BOTTOM_PX = 80

export function isNearScrollBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  thresholdPx = CHAT_TIMELINE_NEAR_BOTTOM_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight < thresholdPx
}

/** True when a wheel gesture scrolls away from the bottom (content moves down). */
export function isWheelScrollAwayFromBottom(deltaY: number): boolean {
  return deltaY < 0
}
