import { describe, expect, test } from 'bun:test'
import {
  CHAT_TIMELINE_NEAR_BOTTOM_PX,
  isNearScrollBottom,
  isWheelScrollAwayFromBottom,
} from './chat-timeline-scroll'

describe('isNearScrollBottom', () => {
  test('returns true when within the bottom threshold', () => {
    expect(isNearScrollBottom(1000, 920, 100, CHAT_TIMELINE_NEAR_BOTTOM_PX)).toBe(true)
  })

  test('returns false when scrolled away from the bottom', () => {
    expect(isNearScrollBottom(1000, 400, 100, CHAT_TIMELINE_NEAR_BOTTOM_PX)).toBe(false)
  })
})

describe('isWheelScrollAwayFromBottom', () => {
  test('detects upward wheel gestures', () => {
    expect(isWheelScrollAwayFromBottom(-1)).toBe(true)
    expect(isWheelScrollAwayFromBottom(1)).toBe(false)
  })
})

describe('scroll pin reproduction', () => {
  test('simulates user scroll-up then content growth without re-pinning', () => {
    let scrollTop = 900
    const scrollHeight = 1000
    const clientHeight = 100
    let pinned = isNearScrollBottom(scrollHeight, scrollTop, clientHeight)

    expect(pinned).toBe(true)

    scrollTop -= 120
    if (isWheelScrollAwayFromBottom(-120)) {
      pinned = false
    }
    expect(pinned).toBe(false)

    const nextScrollHeight = 1200
    if (pinned) {
      scrollTop = nextScrollHeight - clientHeight
    }

    expect(scrollTop).toBe(780)
    expect(isNearScrollBottom(nextScrollHeight, scrollTop, clientHeight)).toBe(false)
  })
})
