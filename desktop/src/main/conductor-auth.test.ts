import { describe, expect, it } from 'bun:test'
import { parseCursorCliAuthJson } from './conductor-auth'

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
