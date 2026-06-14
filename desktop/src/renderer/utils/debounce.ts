export interface TrailingDebounce {
  /** Schedule a trailing-edge run after the (possibly dynamic) delay. */
  (): void
  /** Cancel any pending run and forget any in-flight re-fire. */
  cancel: () => void
  /** Run the pending work now (no-op while a run is already in flight). */
  flush: () => void
}

/**
 * Trailing-edge debounce with drop-while-busy + trailing re-fire — VS Code's
 * `RunOnceWorker` shape. A burst of calls collapses to a single run after the
 * delay's quiet window. If more calls arrive while an async `fn` is still
 * running, they don't start a second concurrent run; instead exactly one more
 * run is scheduled after the current one settles, so the final update is never
 * missed and a slow handler never overlaps itself.
 *
 * `delayMs` may be a number or a getter, so the window can change at runtime
 * (e.g. a longer window once a repo is known to be huge).
 */
export function createTrailingDebounce(
  fn: () => void | Promise<void>,
  delayMs: number | (() => number),
): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let pending = false

  const resolveDelay = () => (typeof delayMs === 'function' ? delayMs() : delayMs)

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, resolveDelay())
  }

  const run = () => {
    timer = null
    if (running) {
      // A run is already in flight — remember to fire once more when it settles.
      pending = true
      return
    }
    running = true
    let result: void | Promise<void>
    try {
      result = fn()
    } catch {
      result = undefined
    }
    Promise.resolve(result)
      .catch(() => {})
      .finally(() => {
        running = false
        if (pending) {
          pending = false
          schedule()
        }
      })
  }

  const debounced = (() => {
    schedule()
  }) as TrailingDebounce

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pending = false
  }

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    run()
  }

  return debounced
}
