import { describe, expect, it } from 'bun:test'
import type { GraphiteStackInfo } from '../../../shared/graphite-types'
import { formatLinearWorkContextLabel } from './format-linear-work-context'

describe('formatLinearWorkContextLabel', () => {
  it('prefers Graphite when stack has multiple branches', () => {
    const g: GraphiteStackInfo = {
      branches: [
        { name: 'main', parent: null },
        { name: 'feat-x', parent: 'main' },
      ],
      currentBranch: 'feat-x',
    }
    expect(formatLinearWorkContextLabel('feat-x', g)).toBe('feat-x · stack')
  })

  it('uses Graphite current branch when single-branch stack', () => {
    const g: GraphiteStackInfo = {
      branches: [{ name: 'solo', parent: null }],
      currentBranch: 'solo',
    }
    expect(formatLinearWorkContextLabel('other', g)).toBe('solo')
  })

  it('falls back to workspace branch when no graphite', () => {
    expect(formatLinearWorkContextLabel('my-branch', null)).toBe('my-branch')
  })

  it('shows no workspace when nothing else applies', () => {
    expect(formatLinearWorkContextLabel(null, null)).toBe('no workspace')
  })
})
