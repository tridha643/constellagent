import { describe, expect, it } from 'bun:test'
import { createTrailingDebounce } from './debounce'

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('createTrailingDebounce', () => {
  it('collapses a burst into a single trailing run', async () => {
    let calls = 0
    const debounced = createTrailingDebounce(() => { calls += 1 }, 20)
    debounced()
    debounced()
    debounced()
    expect(calls).toBe(0)
    await tick(50)
    expect(calls).toBe(1)
  })

  it('does not overlap a slow async run and re-fires exactly once for in-flight triggers', async () => {
    let starts = 0
    let active = 0
    let maxActive = 0
    const debounced = createTrailingDebounce(async () => {
      starts += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await tick(60)
      active -= 1
    }, 20)

    debounced()        // schedule run #1
    await tick(35)     // run #1 has started and is mid-flight (~60ms)
    debounced()        // these three arrive during run #1 ...
    debounced()
    debounced()        // ... and must coalesce into a single re-fire
    await tick(15)
    expect(starts).toBe(1)   // still only run #1; no overlap
    await tick(120)          // run #1 settles -> one re-fire scheduled + run
    expect(starts).toBe(2)   // exactly one re-fire, not three
    expect(maxActive).toBe(1) // never ran concurrently
  })

  it('cancel() drops a pending run', async () => {
    let calls = 0
    const debounced = createTrailingDebounce(() => { calls += 1 }, 20)
    debounced()
    debounced.cancel()
    await tick(50)
    expect(calls).toBe(0)
  })

  it('flush() runs the pending work immediately', async () => {
    let calls = 0
    const debounced = createTrailingDebounce(() => { calls += 1 }, 1000)
    debounced()
    debounced.flush()
    expect(calls).toBe(1)
  })

  it('reads the delay fresh each schedule (dynamic window)', async () => {
    let calls = 0
    let delay = 15
    const debounced = createTrailingDebounce(() => { calls += 1 }, () => delay)
    debounced()
    await tick(35)
    expect(calls).toBe(1)

    delay = 80
    debounced()
    await tick(35)
    expect(calls).toBe(1) // longer window has not elapsed yet
    await tick(80)
    expect(calls).toBe(2)
  })
})
