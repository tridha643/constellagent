import { describe, expect, test } from 'bun:test'
import type { TranscriptMessage } from './pi/pi-desktop-state'
import {
  applyAssistantDeltaToTranscript,
  buildTurnDurationMap,
  cloneTranscriptWithNewIds,
  groupTranscriptIntoTurns,
  parseWorkedForLabel,
  sliceTranscriptForFork,
} from './conductor-transcript-utils'

function msg(id: string, role: 'user' | 'assistant', text: string): TranscriptMessage {
  return { kind: 'message', id, role, text, createdAt: new Date().toISOString() }
}

describe('conductor-transcript-utils', () => {
  test('parseWorkedForLabel', () => {
    expect(parseWorkedForLabel('Worked for 4s')).toBe('4s')
    expect(parseWorkedForLabel('Completed')).toBeUndefined()
  })

  test('buildTurnDurationMap', () => {
    const t: TranscriptMessage[] = [
      msg('u1', 'user', 'hi'),
      msg('a1', 'assistant', 'hello'),
      {
        kind: 'summary',
        id: 's1',
        createdAt: '',
        label: 'Worked for 4s',
        presentation: 'divider',
      },
    ]
    expect(buildTurnDurationMap(t).get('a1')).toBe('4s')
  })

  test('sliceTranscriptForFork trims Working activity', () => {
    const t: TranscriptMessage[] = [
      msg('u1', 'user', 'hi'),
      msg('a1', 'assistant', 'bye'),
      { kind: 'activity', id: 'w1', createdAt: '', label: 'Working…' },
    ]
    const slice = sliceTranscriptForFork(t, 'a1')
    expect(slice).toHaveLength(2)
    expect(slice.every((i) => i.id !== 'w1')).toBe(true)
  })

  test('cloneTranscriptWithNewIds', () => {
    const t = [msg('a1', 'assistant', 'x')]
    const cloned = cloneTranscriptWithNewIds(t)
    expect(cloned[0].id).not.toBe('a1')
  })

  test('groupTranscriptIntoTurns', () => {
    const t: TranscriptMessage[] = [
      msg('u1', 'user', 'first'),
      msg('a1', 'assistant', 'answer one'),
      msg('u2', 'user', 'second'),
    ]
    const turns = groupTranscriptIntoTurns(t)
    expect(turns).toHaveLength(2)
    expect(turns[0].userText).toBe('first')
    expect(turns[0].assistantPreview).toContain('answer')
    expect(turns[1].userText).toBe('second')
  })

  test('applyAssistantDeltaToTranscript appends to an existing assistant row', () => {
    const t = [msg('a1', 'assistant', 'hel')]
    const next = applyAssistantDeltaToTranscript(t, 'a1', 'lo')
    expect(next).toHaveLength(1)
    expect(next[0].kind === 'message' && next[0].text).toBe('hello')
  })

  test('applyAssistantDeltaToTranscript creates a row when missing', () => {
    const next = applyAssistantDeltaToTranscript([], 'a-new', 'hi')
    expect(next).toHaveLength(1)
    expect(next[0].kind === 'message' && next[0].id).toBe('a-new')
    expect(next[0].kind === 'message' && next[0].text).toBe('hi')
  })

  test('groupTranscriptIntoTurns records plan mode on user turns', () => {
    const t: TranscriptMessage[] = [
      { kind: 'message', id: 'u1', role: 'user', text: 'plan this', createdAt: '', conductorPlan: true },
      msg('a1', 'assistant', 'here is the plan'),
      msg('u2', 'user', 'implement'),
    ]
    const turns = groupTranscriptIntoTurns(t)
    expect(turns[0].plan).toBe(true)
    expect(turns[1].plan).toBeUndefined()
  })
})
