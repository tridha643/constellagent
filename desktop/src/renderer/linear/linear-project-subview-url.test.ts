import { describe, expect, it } from 'vitest'
import { buildLinearProjectSubviewUrl, type LinearProjectNode } from './linear-api'

describe('buildLinearProjectSubviewUrl', () => {
  const base: LinearProjectNode = {
    id: 'p1',
    name: 'Roadmap',
    slugId: 'rd-abc',
    url: 'https://linear.app/acme/project/rd-abc',
  }

  it('appends subview to a plain project url', () => {
    expect(buildLinearProjectSubviewUrl(base, 'issues')).toBe(
      'https://linear.app/acme/project/rd-abc/issues',
    )
    expect(buildLinearProjectSubviewUrl(base, 'updates')).toBe(
      'https://linear.app/acme/project/rd-abc/updates',
    )
    expect(buildLinearProjectSubviewUrl(base, 'overview')).toBe(
      'https://linear.app/acme/project/rd-abc/overview',
    )
  })

  it('replaces an existing /overview suffix', () => {
    const p = { ...base, url: 'https://linear.app/acme/project/rd-abc/overview' }
    expect(buildLinearProjectSubviewUrl(p, 'issues')).toBe(
      'https://linear.app/acme/project/rd-abc/issues',
    )
  })

  it('replaces other known subview suffixes', () => {
    for (const suffix of ['issues', 'updates', 'documents', 'members', 'activity']) {
      const p = { ...base, url: `https://linear.app/acme/project/rd-abc/${suffix}` }
      expect(buildLinearProjectSubviewUrl(p, 'updates')).toBe(
        'https://linear.app/acme/project/rd-abc/updates',
      )
    }
  })

  it('strips a trailing slash before appending', () => {
    const p = { ...base, url: 'https://linear.app/acme/project/rd-abc/' }
    expect(buildLinearProjectSubviewUrl(p, 'issues')).toBe(
      'https://linear.app/acme/project/rd-abc/issues',
    )
  })

  it('falls back to slugId when url is missing', () => {
    const p: LinearProjectNode = { id: 'p1', name: 'R', slugId: 'rd-abc', url: '' }
    expect(buildLinearProjectSubviewUrl(p, 'issues')).toBe(
      'https://linear.app/project/rd-abc/issues',
    )
  })

  it('returns workspace root when project is null/undefined', () => {
    expect(buildLinearProjectSubviewUrl(null, 'issues')).toBe('https://linear.app')
    expect(buildLinearProjectSubviewUrl(undefined, 'updates')).toBe('https://linear.app')
  })

  it('returns workspace root when both url and slugId are missing', () => {
    const p: LinearProjectNode = { id: 'p1', name: 'R', slugId: '', url: '' }
    expect(buildLinearProjectSubviewUrl(p, 'issues')).toBe('https://linear.app')
  })
})
