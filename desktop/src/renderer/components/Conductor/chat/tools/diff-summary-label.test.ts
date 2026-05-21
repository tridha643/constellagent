import { describe, expect, it } from 'bun:test'
import { diffActionVerb, diffSummaryLabel } from './diff-summary-label'

describe('diffSummaryLabel', () => {
  it('keeps an existing compact harness label', () => {
    expect(diffSummaryLabel('write', 'Write 42 lines', 42, 0)).toBe('Write 42 lines')
  })

  it('builds write labels from addition counts', () => {
    expect(diffSummaryLabel('write', 'Wrote foo.ts', 42, 0)).toBe('Write 42 lines')
  })

  it('builds edit labels from total changed lines', () => {
    expect(diffSummaryLabel('apply_patch', 'Edited foo.ts', 2, 1)).toBe('Edit 3 lines')
  })
})

describe('diffActionVerb', () => {
  it('returns Write for write tools and add-only patches', () => {
    expect(diffActionVerb('write', 5, 0)).toBe('Write')
    expect(diffActionVerb('apply_patch', 3, 0)).toBe('Write')
  })

  it('returns Delete for delete-only patches', () => {
    expect(diffActionVerb('delete_file', 0, 4)).toBe('Delete')
    expect(diffActionVerb('apply_patch', 0, 2)).toBe('Delete')
  })

  it('returns Edit when both sides change', () => {
    expect(diffActionVerb('apply_patch', 2, 1)).toBe('Edit')
  })
})
