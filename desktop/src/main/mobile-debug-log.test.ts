import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  isMobileDebugEnabled,
  mobileDebugLog,
  MobileDebugTimer,
  shouldSampleMobileDelta,
} from './mobile-debug-log'

describe('mobile debug log', () => {
  const original = process.env.CONSTELLAGENT_MOBILE_DEBUG

  beforeEach(() => {
    delete process.env.CONSTELLAGENT_MOBILE_DEBUG
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CONSTELLAGENT_MOBILE_DEBUG
    } else {
      process.env.CONSTELLAGENT_MOBILE_DEBUG = original
    }
  })

  test('isMobileDebugEnabled respects CONSTELLAGENT_MOBILE_DEBUG', () => {
    expect(isMobileDebugEnabled()).toBe(false)
    process.env.CONSTELLAGENT_MOBILE_DEBUG = '1'
    expect(isMobileDebugEnabled()).toBe(true)
    process.env.CONSTELLAGENT_MOBILE_DEBUG = 'true'
    expect(isMobileDebugEnabled()).toBe(true)
  })

  test('mobileDebugLog is a no-op when disabled', () => {
    expect(() => mobileDebugLog('test', 'hello', { ok: true })).not.toThrow()
  })

  test('MobileDebugTimer finish reports duration when enabled', () => {
    process.env.CONSTELLAGENT_MOBILE_DEBUG = '1'
    const timer = new MobileDebugTimer('router', 'session.reply', { sessionId: 's1' })
    const durationMs = timer.finish({ ok: true })
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  test('shouldSampleMobileDelta samples first and every Nth event', () => {
    expect(shouldSampleMobileDelta(1)).toBe(true)
    expect(shouldSampleMobileDelta(2)).toBe(false)
    expect(shouldSampleMobileDelta(25)).toBe(true)
  })
})
