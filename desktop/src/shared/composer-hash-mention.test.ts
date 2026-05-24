import { describe, expect, test } from 'bun:test'
import type { OpenPrInfo } from './github-types'
import {
  filterOpenPrsByHashQuery,
  formatHashMentionInsert,
  parseActiveHashToken,
  prComposerBranchLabel,
} from './composer-hash-mention'

describe('parseActiveHashToken', () => {
  test('detects hash at start', () => {
    expect(parseActiveHashToken('#17', 3)).toEqual({ query: '#17', from: 0, to: 3 })
  })

  test('detects hash after whitespace', () => {
    expect(parseActiveHashToken('see #170', 8)).toEqual({ query: '#170', from: 4, to: 8 })
  })

  test('rejects markdown headings with spaces', () => {
    expect(parseActiveHashToken('# Heading', 9)).toBeNull()
  })

  test('rejects hash inside words', () => {
    expect(parseActiveHashToken('foo#170', 7)).toBeNull()
  })
})

describe('filterOpenPrsByHashQuery', () => {
  const prs: OpenPrInfo[] = [
    {
      number: 170,
      state: 'open',
      title: 'docs(agents): add automation section',
      url: 'https://github.com/o/r/pull/170',
      checkStatus: 'none',
      hasPendingComments: false,
      pendingCommentCount: 0,
      isBlockedByCi: false,
      isApproved: false,
      isChangesRequested: false,
      updatedAt: '2026-01-01T00:00:00Z',
      headRefName: 'auto/constellagent-email-to-pr/20240516',
      baseRefName: 'main',
      isCrossRepository: false,
      authorLogin: 'tri',
    },
    {
      number: 42,
      state: 'open',
      title: 'Fix login bug',
      url: 'https://github.com/o/r/pull/42',
      checkStatus: 'none',
      hasPendingComments: false,
      pendingCommentCount: 0,
      isBlockedByCi: false,
      isApproved: false,
      isChangesRequested: false,
      updatedAt: '2026-01-01T00:00:00Z',
      headRefName: 'fix/login',
      baseRefName: 'main',
      isCrossRepository: false,
    },
  ]

  test('returns all PRs for bare hash', () => {
    expect(filterOpenPrsByHashQuery(prs, '#')).toHaveLength(2)
  })

  test('filters by number prefix', () => {
    expect(filterOpenPrsByHashQuery(prs, '#17')).toHaveLength(1)
    expect(filterOpenPrsByHashQuery(prs, '#17')[0]?.number).toBe(170)
  })

  test('filters by title fragment', () => {
    expect(filterOpenPrsByHashQuery(prs, '#login')).toHaveLength(1)
    expect(filterOpenPrsByHashQuery(prs, '#login')[0]?.number).toBe(42)
  })
})

describe('formatHashMentionInsert', () => {
  test('inserts number with trailing space', () => {
    expect(
      formatHashMentionInsert({
        number: 170,
      } as OpenPrInfo),
    ).toBe('#170 ')
  })
})

describe('prComposerBranchLabel', () => {
  test('uses head ref for same-repo PRs', () => {
    expect(
      prComposerBranchLabel({
        number: 1,
        headRefName: 'feature/foo',
        isCrossRepository: false,
      } as OpenPrInfo),
    ).toBe('feature/foo')
  })
})
