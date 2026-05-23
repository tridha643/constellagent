import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  CODEX_PLAN_THREAD_PERMISSIONS,
  CODEX_WORKING_THREAD_PERMISSIONS,
  CURSOR_PLAN_LOCAL_PERMISSIONS,
  CURSOR_WORKING_LOCAL_PERMISSIONS,
  codexConductorThreadPermissions,
  cursorConductorLocalPermissions,
} from './conductor-sdk-cli-permissions'

describe('CODEX_PLAN_THREAD_PERMISSIONS', () => {
  test('uses read-only sandbox for chat-rendered plans', () => {
    assert.deepEqual(CODEX_PLAN_THREAD_PERMISSIONS, {
      sandboxMode: 'read-only',
      networkAccessEnabled: true,
      approvalPolicy: 'never',
    })
  })
})

describe('CODEX_WORKING_THREAD_PERMISSIONS', () => {
  test('uses fully unrestricted permissions including network', () => {
    assert.deepEqual(CODEX_WORKING_THREAD_PERMISSIONS, {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      networkAccessEnabled: true,
    })
  })
})

describe('codexConductorThreadPermissions', () => {
  test('selects plan profile when plan is true', () => {
    assert.deepEqual(codexConductorThreadPermissions(true), CODEX_PLAN_THREAD_PERMISSIONS)
  })

  test('selects working profile when plan is false', () => {
    assert.deepEqual(codexConductorThreadPermissions(false), CODEX_WORKING_THREAD_PERMISSIONS)
  })
})

describe('cursorConductorLocalPermissions', () => {
  test('enables sandbox in plan mode to block file writes', () => {
    assert.deepEqual(cursorConductorLocalPermissions(true), CURSOR_PLAN_LOCAL_PERMISSIONS)
  })

  test('disables sandbox in working mode for unrestricted approvalMode', () => {
    assert.deepEqual(cursorConductorLocalPermissions(false), CURSOR_WORKING_LOCAL_PERMISSIONS)
  })
})
