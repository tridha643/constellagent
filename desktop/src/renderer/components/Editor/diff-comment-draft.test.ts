import { describe, expect, it } from 'bun:test'
import { isDiffCommentDraftDirty } from './diff-comment-draft'

describe('diff comment drafts', () => {
  it('derives dirty state from lifted body text', () => {
    const range = { side: 'additions' as const, lineNumber: 1, lineEnd: 1 }
    expect(isDiffCommentDraftDirty({ range, body: '' })).toBe(false)
    expect(isDiffCommentDraftDirty({ range, body: '   ' })).toBe(false)
    expect(isDiffCommentDraftDirty({ range, body: 'keep this draft' })).toBe(true)
    expect(isDiffCommentDraftDirty(undefined)).toBe(false)
  })
})
