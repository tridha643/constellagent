import { describe, expect, it } from 'bun:test'
import { buildSuggestionBlock } from './review-suggestion-block'

describe('buildSuggestionBlock', () => {
  it('uses a GitHub-compatible suggestion fence without a language suffix', () => {
    expect(buildSuggestionBlock('color: red;')).toBe('```suggestion\ncolor: red;\n```\n')
  })

  it('preserves selected code exactly inside the suggestion body', () => {
    const seed = '  line one\n    line two'
    expect(buildSuggestionBlock(seed)).toBe('```suggestion\n  line one\n    line two\n```\n')
  })
})
