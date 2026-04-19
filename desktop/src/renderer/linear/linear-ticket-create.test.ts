import { describe, expect, it } from 'vitest'
import {
  linearWorkspaceViewNext,
  linearWorkspaceViewPrev,
  normalizeLinearWorkspaceTabOrder,
} from '../store/types'

describe('normalizeLinearWorkspaceTabOrder', () => {
  it('defaults to issues, tickets, updates', () => {
    expect(normalizeLinearWorkspaceTabOrder(undefined)).toEqual([
      'issues',
      'tickets',
      'updates',
    ])
  })

  it('preserves user order and appends missing tabs', () => {
    expect(normalizeLinearWorkspaceTabOrder(['updates', 'issues'])).toEqual([
      'updates',
      'issues',
      'tickets',
    ])
  })

  it('dedupes and drops unknown ids', () => {
    expect(
      normalizeLinearWorkspaceTabOrder([
        'issues',
        'issues',
        'updates',
        'bogus' as unknown as string,
      ]),
    ).toEqual(['issues', 'updates', 'tickets'])
  })
})

describe('linearWorkspaceViewNext / linearWorkspaceViewPrev', () => {
  const order = ['updates', 'issues', 'tickets'] as const

  it('next wraps from last to first', () => {
    expect(linearWorkspaceViewNext('tickets', [...order])).toBe('updates')
  })

  it('prev wraps from first to last', () => {
    expect(linearWorkspaceViewPrev('updates', [...order])).toBe('tickets')
  })

  it('next/prev from middle', () => {
    expect(linearWorkspaceViewNext('issues', [...order])).toBe('tickets')
    expect(linearWorkspaceViewPrev('issues', [...order])).toBe('updates')
  })
})
