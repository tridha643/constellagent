import { describe, expect, test } from 'bun:test'
import {
  codexConductorThreadPermissions,
  cursorConductorLocalPermissions,
} from './conductor-sdk-cli-permissions'

describe('codexConductorThreadPermissions', () => {
  test('uses read-only sandbox in plan mode', () => {
    expect(codexConductorThreadPermissions(true)).toEqual({ sandboxMode: 'read-only' })
  })

  test('uses unrestricted CLI permissions in working mode', () => {
    expect(codexConductorThreadPermissions(false)).toEqual({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    })
  })
})

describe('cursorConductorLocalPermissions', () => {
  test('leaves sandbox unset in plan mode', () => {
    expect(cursorConductorLocalPermissions(true)).toEqual({})
  })

  test('disables sandbox in working mode for unrestricted approvalMode', () => {
    expect(cursorConductorLocalPermissions(false)).toEqual({ sandboxOptions: { enabled: false } })
  })
})
