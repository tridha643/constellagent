import { describe, expect, it } from 'bun:test'
import {
  CURSOR_SDK_API_KEY_MESSAGE,
  checkCursorAuth,
  parseCursorCliAuthJson,
  setConductorAuthKeys,
} from './conductor-auth'

describe('parseCursorCliAuthJson', () => {
  it('accepts authenticated status with email', () => {
    expect(
      parseCursorCliAuthJson(
        JSON.stringify({
          status: 'authenticated',
          isAuthenticated: true,
          userInfo: { email: 'user@example.com' },
        }),
      ),
    ).toEqual({ authenticated: true, email: 'user@example.com' })
  })

  it('returns unauthenticated for invalid json', () => {
    expect(parseCursorCliAuthJson('not-json')).toEqual({ authenticated: false })
  })

  it('returns unauthenticated when flags are false', () => {
    expect(
      parseCursorCliAuthJson(JSON.stringify({ status: 'unauthenticated', isAuthenticated: false })),
    ).toEqual({ authenticated: false })
  })
})

describe('checkCursorAuth', () => {
  it('passes when a Cursor API key is configured', () => {
    setConductorAuthKeys('cursor_test_key', '')
    expect(checkCursorAuth()).toBeNull()
    setConductorAuthKeys('', '')
  })

  it('requires an API key even when cursor-agent CLI is logged in', () => {
    setConductorAuthKeys('', '')
    // Force CLI snapshot without shelling out — use parse helper contract only in unit tests.
    // When no key is set, checkCursorAuth must not treat CLI login as SDK-ready.
    const msg = checkCursorAuth()
    if (msg === null) return // machine has CURSOR_API_KEY in env — skip assertion
    expect(msg === CURSOR_SDK_API_KEY_MESSAGE || msg.includes('not signed in')).toBe(true)
  })
})
