import { describe, expect, it } from 'bun:test'
import type { FileDiffMetadata } from '@pierre/diffs'
import { getSuggestionSeedForLineRange } from './review-suggestion-seeds'

// Minimal FileDiffMetadata: one hunk starting at new-file line 10 with a context
// block (2 lines) then a change block (2 additions). additionLines holds the text.
function fileDiff(): FileDiffMetadata {
  return {
    additionLines: ['ctx-a', 'ctx-b', 'add-c', 'add-d'],
    hunks: [
      {
        additionStart: 10,
        hunkContent: [
          { type: 'context', lines: 2, additionLineIndex: 0, deletionLineIndex: 0 },
          { type: 'change', deletions: 0, deletionLineIndex: 0, additions: 2, additionLineIndex: 2 },
        ],
      },
    ],
  } as unknown as FileDiffMetadata
}

describe('getSuggestionSeedForLineRange', () => {
  it('returns the addition text for a multi-line range', () => {
    // lines 10..13 → ctx-a, ctx-b, add-c, add-d
    expect(getSuggestionSeedForLineRange(fileDiff(), 10, 13)).toBe('ctx-a\nctx-b\nadd-c\nadd-d')
  })

  it('returns a single addition line', () => {
    expect(getSuggestionSeedForLineRange(fileDiff(), 12, 12)).toBe('add-c')
  })

  it('normalizes reversed ranges', () => {
    expect(getSuggestionSeedForLineRange(fileDiff(), 13, 12)).toBe('add-c\nadd-d')
  })

  it('returns undefined when a line in range has no addition text', () => {
    // line 14 is past the mapped addition lines → not seedable
    expect(getSuggestionSeedForLineRange(fileDiff(), 12, 14)).toBeUndefined()
  })

  it('returns undefined for missing inputs', () => {
    expect(getSuggestionSeedForLineRange(undefined, 1, 2)).toBeUndefined()
    expect(getSuggestionSeedForLineRange(fileDiff(), null, 2)).toBeUndefined()
    expect(getSuggestionSeedForLineRange(fileDiff(), 1, null)).toBeUndefined()
  })
})
