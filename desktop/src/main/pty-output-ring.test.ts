import { describe, expect, test } from 'bun:test'
import { PtyOutputRing } from './pty-output-ring'

describe('PtyOutputRing', () => {
  test('returns the empty string when no data has been appended', () => {
    const ring = new PtyOutputRing(1024)
    expect(ring.snapshot()).toBe('')
    expect(ring.size).toBe(0)
  })

  test('ignores empty chunks', () => {
    const ring = new PtyOutputRing(1024)
    ring.append('')
    expect(ring.size).toBe(0)
    expect(ring.snapshot()).toBe('')
  })

  test('accumulates chunks up to the byte budget without trimming', () => {
    const ring = new PtyOutputRing(10)
    ring.append('abc')
    ring.append('de')
    expect(ring.size).toBe(5)
    expect(ring.snapshot()).toBe('abcde')
  })

  test('drops whole chunks from the front when over budget', () => {
    const ring = new PtyOutputRing(6)
    ring.append('aaa') // 3
    ring.append('bbb') // 6
    ring.append('ccc') // would be 9 → shift "aaa", left with "bbbccc" = 6
    expect(ring.size).toBe(6)
    expect(ring.snapshot()).toBe('bbbccc')
  })

  test('partially slices the head chunk when a single chunk overflows', () => {
    const ring = new PtyOutputRing(4)
    ring.append('123456789') // 9 bytes vs budget 4 → keep last 4
    expect(ring.size).toBe(4)
    expect(ring.snapshot()).toBe('6789')
  })

  test('keeps the strict byte bound across many appends', () => {
    const ring = new PtyOutputRing(100)
    for (let i = 0; i < 1000; i += 1) {
      ring.append('x'.repeat(7))
    }
    expect(ring.size).toBeLessThanOrEqual(100)
    expect(ring.snapshot().length).toBe(ring.size)
    expect(ring.snapshot()).toBe('x'.repeat(ring.size))
  })

  test('snapshot consolidates so subsequent snapshots are O(1)', () => {
    const ring = new PtyOutputRing(1024)
    ring.append('hello ')
    ring.append('world')
    const first = ring.snapshot()
    const second = ring.snapshot()
    expect(first).toBe('hello world')
    expect(second).toBe('hello world')
    // append after snapshot still works correctly
    ring.append('!')
    expect(ring.snapshot()).toBe('hello world!')
  })

  test('handles a chunk larger than the budget by trimming to last maxBytes', () => {
    const ring = new PtyOutputRing(5)
    ring.append('seed')                // 4 bytes, under budget
    ring.append('XYZABCDEFGHIJK')      // single chunk far exceeds budget
    expect(ring.size).toBe(5)
    expect(ring.snapshot()).toBe('FGHIJK'.slice(-5))
  })
})
