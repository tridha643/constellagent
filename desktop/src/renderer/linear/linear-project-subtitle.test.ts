import { describe, expect, it } from 'vitest'
import { formatLinearProjectRowSubtitle, type LinearProjectNode } from './linear-api'

describe('formatLinearProjectRowSubtitle', () => {
  it('returns empty string when no teams or org', () => {
    const p: LinearProjectNode = { id: '1', name: 'A', slugId: 'a', url: '' }
    expect(formatLinearProjectRowSubtitle(p)).toBe('')
  })

  it('formats key · name per team and appends organization', () => {
    const p: LinearProjectNode = {
      id: '1',
      name: 'Roadmap',
      slugId: 'rd',
      url: '',
      teamSummaries: [
        { key: 'ENG', name: 'Engineering' },
        { key: 'DES', name: 'Design' },
      ],
      organizationName: 'Acme',
    }
    expect(formatLinearProjectRowSubtitle(p)).toBe(
      'ENG · Engineering · DES · Design · Acme',
    )
  })

  it('uses organization alone when no teams', () => {
    const p: LinearProjectNode = {
      id: '1',
      name: 'Solo',
      slugId: 's',
      url: '',
      organizationName: 'Beta Org',
    }
    expect(formatLinearProjectRowSubtitle(p)).toBe('Beta Org')
  })
})
