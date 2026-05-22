import { describe, expect, test } from 'bun:test'
import {
  enqueueQueuedMessage,
  findSteerMessageIndex,
  moveQueuedMessageUp,
  parseQueuedMessagesJson,
  removeQueuedMessage,
  updateQueuedMessageText,
} from './agent-chat-queue'
import type { QueuedAgentMessage } from '../shared/agent-chat-types'

const ts = '2026-05-21T00:00:00.000Z'

function msg(id: string, mode: QueuedAgentMessage['mode'], text: string): QueuedAgentMessage {
  return { id, mode, text, createdAt: ts, updatedAt: ts }
}

describe('agent-chat-queue helpers', () => {
  test('enqueueQueuedMessage appends followUp messages in FIFO order', () => {
    const queue = enqueueQueuedMessage([], 'first', 'followUp', ts)
    const next = enqueueQueuedMessage(queue, 'second', 'followUp', ts)
    expect(next.map((item) => item.text)).toEqual(['first', 'second'])
  })

  test('enqueueQueuedMessage replaces an existing steer slot', () => {
    const initial = [msg('a', 'followUp', 'wait'), msg('b', 'steer', 'old steer')]
    const next = enqueueQueuedMessage(initial, 'new steer', 'steer', ts)
    expect(next.map((item) => item.text)).toEqual(['wait', 'new steer'])
    expect(next.filter((item) => item.mode === 'steer')).toHaveLength(1)
  })

  test('findSteerMessageIndex returns the steer row index', () => {
    const queue = [msg('a', 'followUp', 'one'), msg('b', 'steer', 'steer me')]
    expect(findSteerMessageIndex(queue)).toBe(1)
  })

  test('removeQueuedMessage and moveQueuedMessageUp mutate order predictably', () => {
    const queue = [msg('a', 'followUp', 'one'), msg('b', 'followUp', 'two')]
    expect(removeQueuedMessage(queue, 'a').map((item) => item.id)).toEqual(['b'])
    expect(moveQueuedMessageUp(queue, 'b').map((item) => item.id)).toEqual(['b', 'a'])
  })

  test('updateQueuedMessageText updates only the targeted row', () => {
    const queue = [msg('a', 'followUp', 'one'), msg('b', 'followUp', 'two')]
    const next = updateQueuedMessageText(queue, 'b', 'edited', ts)
    expect(next[1]?.text).toBe('edited')
    expect(next[0]?.text).toBe('one')
  })

  test('parseQueuedMessagesJson ignores invalid payloads', () => {
    expect(parseQueuedMessagesJson('[]')).toEqual([])
    expect(parseQueuedMessagesJson('not-json')).toEqual([])
    expect(parseQueuedMessagesJson(JSON.stringify([{ id: 'x', mode: 'nope', text: 'bad' }]))).toEqual([])
    expect(
      parseQueuedMessagesJson(
        JSON.stringify([{ id: 'x', mode: 'followUp', text: 'ok', createdAt: ts, updatedAt: ts }]),
      ),
    ).toHaveLength(1)
  })
})
