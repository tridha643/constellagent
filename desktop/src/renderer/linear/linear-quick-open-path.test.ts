import { describe, expect, it } from 'vitest'
import type { LinearUserNode } from './linear-api'
import {
  linearRemoteIssueSearchAudience,
  normalizeLinearQuickOpenQuery,
  tokenizeLinearQuickOpenQuery,
} from './linear-quick-open-path'

describe('normalizeLinearQuickOpenQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeLinearQuickOpenQuery('  a   b  c  ')).toBe('a b c')
  })

  it('returns empty for blank', () => {
    expect(normalizeLinearQuickOpenQuery('   ')).toBe('')
  })
})

describe('tokenizeLinearQuickOpenQuery', () => {
  it('splits on spaces', () => {
    expect(tokenizeLinearQuickOpenQuery('shop todo alice')).toEqual(['shop', 'todo', 'alice'])
  })

  it('returns empty for empty', () => {
    expect(tokenizeLinearQuickOpenQuery('')).toEqual([])
  })
})

describe('linearRemoteIssueSearchAudience', () => {
  const viewer = { id: 'me', name: 'Alex River' }
  const others: LinearUserNode[] = [
    { id: 'u1', name: 'Sam Chen', displayName: 'Sam Chen' },
    { id: 'u2', name: 'Jordan Lee' },
  ]

  it('defaults to mine for generic query', () => {
    expect(linearRemoteIssueSearchAudience('billing bugfix', viewer, others)).toBe('mine')
  })

  it('switches to workspace when another member’s name appears', () => {
    expect(linearRemoteIssueSearchAudience('sam billing', viewer, others)).toBe('workspace')
  })

  it('uses workspace when viewer is unknown', () => {
    expect(linearRemoteIssueSearchAudience('todo', null, others)).toBe('workspace')
  })
})
