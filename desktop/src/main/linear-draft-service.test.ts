import { describe, expect, it } from 'vitest'
import { formatLinearProjectContextForPrompt } from './linear-draft-service'

describe('formatLinearProjectContextForPrompt', () => {
  it('returns empty when no fields', () => {
    expect(formatLinearProjectContextForPrompt({})).toBe('')
    expect(formatLinearProjectContextForPrompt({ projectDescription: null, projectContentMarkdown: null })).toBe(
      '',
    )
  })

  it('includes description section', () => {
    const s = formatLinearProjectContextForPrompt({ projectDescription: 'Ship Q2' })
    expect(s).toContain('## Linear project description')
    expect(s).toContain('Ship Q2')
    expect(s).not.toContain('Linear project document')
  })

  it('includes document section and truncates long markdown', () => {
    const long = 'x'.repeat(20_000)
    const s = formatLinearProjectContextForPrompt({ projectContentMarkdown: long })
    expect(s).toContain('## Linear project document (markdown)')
    expect(s.length).toBeLessThan(long.length)
    expect(s).toContain('…(truncated)')
  })

  it('combines description and content', () => {
    const s = formatLinearProjectContextForPrompt({
      projectDescription: 'One-liner',
      projectContentMarkdown: '## Doc',
    })
    expect(s).toContain('## Linear project description')
    expect(s).toContain('One-liner')
    expect(s).toContain('## Linear project document (markdown)')
    expect(s).toContain('## Doc')
  })
})
