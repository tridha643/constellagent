import { describe, expect, it } from 'bun:test'
import type { DiffAnnotation } from '@shared/diff-annotation-types'
import {
  buildReviewThreadsByFile,
  classifyReviewer,
  getFileReviewThreadsForPath,
  isSelectableHumanComment,
  normalizePath,
} from './review-threads'

function ann(overrides: Partial<DiffAnnotation> & Pick<DiffAnnotation, 'id'>): DiffAnnotation {
  return {
    filePath: 'src/app.ts',
    side: 'additions',
    lineNumber: 10,
    body: 'comment',
    createdAt: '2024-01-01T00:00:00.000Z',
    resolved: false,
    ...overrides,
  }
}

describe('review-threads adapter', () => {
  it('classifies reviewers by author + id prefix', () => {
    expect(classifyReviewer(ann({ id: 'local-1' }))).toBe('local-human')
    expect(classifyReviewer(ann({ id: 'agent-1', author: 'codex' }))).toBe('ai-agent')
    expect(classifyReviewer(ann({ id: 'PRR_kw1', author: 'octocat' }))).toBe('github')
    expect(classifyReviewer(ann({ id: 'IC_kw1', author: 'octocat' }))).toBe('github')
    expect(isSelectableHumanComment(ann({ id: 'local-1' }))).toBe(true)
    expect(isSelectableHumanComment(ann({ id: 'agent-1', author: 'codex' }))).toBe(false)
    expect(isSelectableHumanComment(ann({ id: 'PRR_x', author: 'octocat' }))).toBe(false)
  })

  it('groups co-located comments from all sources into one anchored thread', () => {
    const annotations = [
      ann({ id: 'a', createdAt: '2024-01-01T00:00:03.000Z' }),
      ann({ id: 'b', author: 'codex', createdAt: '2024-01-01T00:00:01.000Z' }),
      ann({ id: 'PRR_c', author: 'octocat', createdAt: '2024-01-01T00:00:02.000Z' }),
      ann({ id: 'd', lineNumber: 20 }),
    ]
    const byFile = buildReviewThreadsByFile(annotations)
    const file = getFileReviewThreadsForPath(byFile, 'src/app.ts')
    expect(file).toBeDefined()
    expect(file!.threads).toHaveLength(2)

    const thread = file!.byAnchor.get('additions:10')!
    expect(thread.id).toBe('additions:10')
    // Mixed sources, oldest-first.
    expect(thread.comments.map((c) => c.id)).toEqual(['b', 'PRR_c', 'a'])
  })

  it('separates threads by side as well as line number', () => {
    const byFile = buildReviewThreadsByFile([
      ann({ id: 'add', side: 'additions', lineNumber: 5 }),
      ann({ id: 'del', side: 'deletions', lineNumber: 5 }),
    ])
    const file = getFileReviewThreadsForPath(byFile, 'src/app.ts')!
    expect(file.threads).toHaveLength(2)
    expect(file.byAnchor.has('additions:5')).toBe(true)
    expect(file.byAnchor.has('deletions:5')).toBe(true)
  })

  it('normalizes leading ./ and / for cross-source path keying', () => {
    expect(normalizePath('./src/app.ts')).toBe('src/app.ts')
    expect(normalizePath('/src/app.ts')).toBe('src/app.ts')
    const byFile = buildReviewThreadsByFile([ann({ id: 'a', filePath: './src/app.ts' })])
    expect(getFileReviewThreadsForPath(byFile, 'src/app.ts')).toBeDefined()
  })
})
