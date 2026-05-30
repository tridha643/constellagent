import { describe, expect, test } from 'bun:test'
import type { OpenPrInfo } from './github-types'
import {
  OPEN_PR_LIST_CACHE_MS,
  isOpenPrListCacheFresh,
  shouldSkipOpenPrListPrefetch,
} from './open-pr-list-cache'

describe('isOpenPrListCacheFresh', () => {
  test('returns true inside the TTL window', () => {
    const now = 1_000_000
    expect(isOpenPrListCacheFresh(now - OPEN_PR_LIST_CACHE_MS + 1, now)).toBe(true)
  })

  test('returns false at or beyond the TTL boundary', () => {
    const now = 1_000_000
    expect(isOpenPrListCacheFresh(now - OPEN_PR_LIST_CACHE_MS, now)).toBe(false)
    expect(isOpenPrListCacheFresh(now - OPEN_PR_LIST_CACHE_MS - 1, now)).toBe(false)
  })
})

describe('shouldSkipOpenPrListPrefetch', () => {
  test('skips only when cache is fresh and non-empty', () => {
    const now = 1_000_000
    expect(
      shouldSkipOpenPrListPrefetch(
        {
          fetchedAt: now,
          available: true,
          error: null,
          data: [{ number: 1 } as OpenPrInfo],
        },
        now,
      ),
    ).toBe(true)
    expect(
      shouldSkipOpenPrListPrefetch(
        {
          fetchedAt: now,
          available: true,
          error: null,
          data: [],
        },
        now,
      ),
    ).toBe(false)
    expect(shouldSkipOpenPrListPrefetch(undefined, now)).toBe(false)
  })
})
