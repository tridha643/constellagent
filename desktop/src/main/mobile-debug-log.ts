/** Opt-in structured logs for the mobile bridge (`CONSTELLAGENT_MOBILE_DEBUG=1`). */

import { safeConsoleInfo, safeConsoleWarn } from './main-console'

export function isMobileDebugEnabled(): boolean {
  const value = process.env.CONSTELLAGENT_MOBILE_DEBUG?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function compactFields(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!fields) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function mobileDebugLog(
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (!isMobileDebugEnabled()) return
  const payload = compactFields(fields)
  if (payload) {
    safeConsoleInfo(`[mobile-debug][${scope}] ${message}`, payload)
    return
  }
  safeConsoleInfo(`[mobile-debug][${scope}] ${message}`)
}

export function mobileDebugWarn(
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (!isMobileDebugEnabled()) return
  const payload = compactFields(fields)
  if (payload) {
    safeConsoleWarn(`[mobile-debug][${scope}] ${message}`, payload)
    return
  }
  safeConsoleWarn(`[mobile-debug][${scope}] ${message}`)
}

export class MobileDebugTimer {
  private readonly startedAt = performance.now()

  constructor(
    private readonly scope: string,
    private readonly label: string,
    private readonly fields?: Record<string, unknown>,
  ) {
    mobileDebugLog(scope, `${label} start`, fields)
  }

  finish(extra?: Record<string, unknown>): number {
    const durationMs = Math.round(performance.now() - this.startedAt)
    mobileDebugLog(this.scope, `${this.label} done`, {
      ...this.fields,
      ...extra,
      durationMs,
    })
    return durationMs
  }

  fail(error: unknown, extra?: Record<string, unknown>): number {
    const durationMs = Math.round(performance.now() - this.startedAt)
    const message = error instanceof Error ? error.message : String(error)
    mobileDebugWarn(this.scope, `${this.label} failed`, {
      ...this.fields,
      ...extra,
      durationMs,
      error: message,
    })
    return durationMs
  }
}

/** Logs every Nth assistant delta to keep streaming traces readable. */
export function shouldSampleMobileDelta(sequence: number, every = 25): boolean {
  return sequence === 1 || sequence % every === 0
}
