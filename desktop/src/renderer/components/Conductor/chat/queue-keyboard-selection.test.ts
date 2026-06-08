import { describe, expect, test } from 'bun:test'
import {
  reconcileSelectedQueueMessageId,
  selectQueueMessageAbove,
  selectQueueMessageBelow,
} from './queue-keyboard-selection'

describe('queue keyboard selection', () => {
  const ids = ['first', 'second', 'third']

  test('ArrowUp enters queue selection at the last message', () => {
    expect(selectQueueMessageAbove(ids, null)).toBe('third')
  })

  test('ArrowUp moves toward earlier queued messages and clamps at the first', () => {
    expect(selectQueueMessageAbove(ids, 'third')).toBe('second')
    expect(selectQueueMessageAbove(ids, 'second')).toBe('first')
    expect(selectQueueMessageAbove(ids, 'first')).toBe('first')
  })

  test('ArrowDown moves toward later queued messages and exits after the last', () => {
    expect(selectQueueMessageBelow(ids, 'first')).toBe('second')
    expect(selectQueueMessageBelow(ids, 'second')).toBe('third')
    expect(selectQueueMessageBelow(ids, 'third')).toBe(null)
  })

  test('selection reconciles when the queued message disappears', () => {
    expect(reconcileSelectedQueueMessageId(ids, 'second')).toBe('second')
    expect(reconcileSelectedQueueMessageId(ids, 'missing')).toBe(null)
    expect(reconcileSelectedQueueMessageId([], 'second')).toBe(null)
  })
})
