import { describe, expect, test } from 'bun:test'
import {
  composerDraftHasInlineChips,
  findComposerDraftTokenBeforeCursor,
  removeComposerDraftRange,
  segmentComposerDraft,
} from './composer-draft-segments'

describe('segmentComposerDraft', () => {
  test('segments inline @ file mentions within prose', () => {
    expect(segmentComposerDraft('fix @src/App.tsx please')).toEqual([
      { kind: 'text', text: 'fix ', start: 0, end: 4 },
      { kind: 'file', relativePath: 'src/App.tsx', start: 4, end: 16 },
      { kind: 'text', text: ' please', start: 16, end: 23 },
    ])
  })

  test('segments inline /skill commands', () => {
    expect(segmentComposerDraft('run /nia on this')).toEqual([
      { kind: 'text', text: 'run ', start: 0, end: 4 },
      { kind: 'skill', command: '/nia', name: 'nia', start: 4, end: 8 },
      { kind: 'text', text: ' on this', start: 8, end: 16 },
    ])
  })

  test('segments inline # pr mentions', () => {
    expect(segmentComposerDraft('review #170 please')).toEqual([
      { kind: 'text', text: 'review ', start: 0, end: 7 },
      { kind: 'pr', number: 170, start: 7, end: 11 },
      { kind: 'text', text: ' please', start: 11, end: 18 },
    ])
  })

  test('keeps host slash commands as plain text', () => {
    expect(segmentComposerDraft('/plan')).toEqual([
      { kind: 'text', text: '/plan', start: 0, end: 5 },
    ])
  })
})

describe('findComposerDraftTokenBeforeCursor', () => {
  test('deletes mention when caret is after trailing space', () => {
    expect(findComposerDraftTokenBeforeCursor('@src/App.tsx ', 13, 13)).toEqual({
      start: 0,
      end: 13,
    })
  })

  test('deletes mention when caret is inside the token', () => {
    expect(findComposerDraftTokenBeforeCursor('see @App.tsx', 11, 11)).toEqual({
      start: 4,
      end: 12,
    })
  })

  test('deletes pr mention when caret is after trailing space', () => {
    expect(findComposerDraftTokenBeforeCursor('#170 ', 5, 5)).toEqual({
      start: 0,
      end: 5,
    })
  })
})

describe('composerDraftHasInlineChips', () => {
  test('detects chips in draft text', () => {
    expect(composerDraftHasInlineChips('@src/App.tsx')).toBe(true)
    expect(composerDraftHasInlineChips('#170 ')).toBe(true)
    expect(composerDraftHasInlineChips('plain text')).toBe(false)
  })
})

describe('removeComposerDraftRange', () => {
  test('splices token out of draft', () => {
    expect(removeComposerDraftRange('fix @src/App.tsx please', 4, 16)).toBe('fix  please')
  })
})
