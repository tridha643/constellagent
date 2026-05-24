import { describe, expect, test } from 'bun:test'
import {
  APPROVE_PLAN_MESSAGE,
  getLatestPlanApprovalMessageId,
  isPlanApprovalMessage,
} from './plan-approval'

describe('plan-approval', () => {
  test('isPlanApprovalMessage matches the canonical approval text', () => {
    expect(isPlanApprovalMessage(APPROVE_PLAN_MESSAGE)).toBe(true)
    expect(isPlanApprovalMessage(`  ${APPROVE_PLAN_MESSAGE}  `)).toBe(true)
    expect(isPlanApprovalMessage('Please proceed')).toBe(false)
  })

  test('getLatestPlanApprovalMessageId returns the latest assistant message before a user reply', () => {
    const id = getLatestPlanApprovalMessageId([
      { kind: 'message', id: 'u1', role: 'user', text: 'plan this', createdAt: '2026-01-01T00:00:00.000Z' },
      { kind: 'message', id: 'a1', role: 'assistant', text: '## Plan', createdAt: '2026-01-01T00:00:01.000Z' },
    ])
    expect(id).toBe('a1')
  })

  test('getLatestPlanApprovalMessageId returns the trailing assistant when it is the newest message item', () => {
    const id = getLatestPlanApprovalMessageId([
      { kind: 'message', id: 'u1', role: 'user', text: 'plan this', createdAt: '2026-01-01T00:00:00.000Z' },
      { kind: 'message', id: 'a1', role: 'assistant', text: '## Plan', createdAt: '2026-01-01T00:00:01.000Z' },
      { kind: 'message', id: 'u2', role: 'user', text: APPROVE_PLAN_MESSAGE, createdAt: '2026-01-01T00:00:02.000Z' },
      { kind: 'message', id: 'a2', role: 'assistant', text: 'Working on it', createdAt: '2026-01-01T00:00:03.000Z' },
    ])
    expect(id).toBe('a2')
  })
})
