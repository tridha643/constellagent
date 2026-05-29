import { describe, expect, it } from 'bun:test'
import {
  CURSOR_SDK_API_KEY_MESSAGE,
  checkCursorAuth,
  cursorAuthMessageForState,
  getConductorAuthStatus,
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
  it('passes when cursor-agent CLI login is authenticated', () => {
    expect(cursorAuthMessageForState(false, true)).toBeNull()
  })

  it('fails when neither Cursor API key nor CLI login is available', () => {
    expect(cursorAuthMessageForState(false, false)).toBe(CURSOR_SDK_API_KEY_MESSAGE)
  })

  it('passes when a Cursor API key is configured', () => {
    setConductorAuthKeys('cursor_test_key', '')
    expect(checkCursorAuth()).toBeNull()
    setConductorAuthKeys('', '')
  })

  it('uses the shared auth message for the live environment when unavailable', () => {
    setConductorAuthKeys('', '')
    const msg = checkCursorAuth()
    if (msg === null) return
    expect(msg).toBe(CURSOR_SDK_API_KEY_MESSAGE)
  })
})

describe('getConductorAuthStatus', () => {
  // Now async so the cursor-agent CLI lookup + `status` call never block the main process.
  it('resolves with cursor ready when an API key is configured (no CLI blocking required)', async () => {
    setConductorAuthKeys('cursor_test_key', '')
    const status = await getConductorAuthStatus()
    expect(status.cursor.ready).toBe(true)
    expect(status.cursor.detail).toBe('API key configured')
    expect(status.pi.ready).toBe(true)
    setConductorAuthKeys('', '')
  })
})
