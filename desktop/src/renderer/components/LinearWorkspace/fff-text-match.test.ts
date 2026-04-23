import { describe, expect, it } from 'vitest'
import { matchesFffQuery } from './fff-text-match'

describe('matchesFffQuery', () => {
  it('returns true for empty / whitespace query', () => {
    expect(matchesFffQuery('anything', '')).toBe(true)
    expect(matchesFffQuery('anything', '   ')).toBe(true)
  })

  it('returns false when haystack is empty and query is not', () => {
    expect(matchesFffQuery('', 'foo')).toBe(false)
  })

  it('matches via fuzzy subsequence (primary)', () => {
    expect(matchesFffQuery('Linear Panel', 'lp')).toBe(true)
    expect(matchesFffQuery('Linear Panel', 'lnr')).toBe(true)
    expect(matchesFffQuery('ENG-123 refactor graph', 'e1rg')).toBe(true)
  })

  it('matches via full-string prefix fallback when fuzzy fails', () => {
    // "li" is a valid fuzzy subsequence of "Linear" too, but prefix must also cover it.
    expect(matchesFffQuery('Linear', 'li')).toBe(true)
    // prefix on full lowercase.
    expect(matchesFffQuery('Engineering roadmap', 'engin')).toBe(true)
  })

  it('matches via per-token prefix fallback across separators', () => {
    expect(matchesFffQuery('my-branch/foo.ts', 'foo')).toBe(true)
    expect(matchesFffQuery('ENG-123: refactor', '123')).toBe(true)
    expect(matchesFffQuery('Project name here', 'here')).toBe(true)
  })

  it('returns false when nothing matches fuzzy or prefix', () => {
    expect(matchesFffQuery('Linear', 'xyz')).toBe(false)
    expect(matchesFffQuery('Project foo', 'zzz')).toBe(false)
  })

  it('is case insensitive', () => {
    expect(matchesFffQuery('LINEAR', 'lin')).toBe(true)
    expect(matchesFffQuery('linear', 'LIN')).toBe(true)
  })
})
