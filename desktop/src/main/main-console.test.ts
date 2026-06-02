import { describe, expect, test } from 'bun:test'
import { installMainProcessBrokenPipeGuard, isBrokenPipeError, safeConsoleCall } from './main-console'

describe('main-console', () => {
  test('installMainProcessBrokenPipeGuard is idempotent', () => {
    expect(() => {
      installMainProcessBrokenPipeGuard()
      installMainProcessBrokenPipeGuard()
    }).not.toThrow()
  })

  test('isBrokenPipeError detects EPIPE', () => {
    const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' as const })
    expect(isBrokenPipeError(err)).toBe(true)
    expect(isBrokenPipeError(new Error('other'))).toBe(false)
  })

  test('safeConsoleCall swallows EPIPE', () => {
    expect(() =>
      safeConsoleCall(() => {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' as const })
      }),
    ).not.toThrow()
  })

  test('safeConsoleCall rethrows non-EPIPE errors', () => {
    expect(() =>
      safeConsoleCall(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
  })
})
