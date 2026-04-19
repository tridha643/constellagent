import { describe, expect, it } from 'vitest'
import {
  encodeLinearRowIdForFilename,
  sanitizeLinearPathSegment,
  syntheticRelativePathForBar,
  syntheticRelativePathForIssue,
  syntheticRelativePathForProject,
} from './linear-synthetic-path'
import type { LinearIssueNode, LinearProjectNode } from './linear-api'

describe('sanitizeLinearPathSegment', () => {
  it('falls back when empty', () => {
    expect(sanitizeLinearPathSegment('@@@', 'fb')).toBe('fb')
  })

  it('strips unsafe chars', () => {
    expect(sanitizeLinearPathSegment('foo/bar baz', 'x')).toMatch(/^foo-bar-baz/)
  })
})

describe('encodeLinearRowIdForFilename', () => {
  it('replaces non-alphanumeric', () => {
    expect(encodeLinearRowIdForFilename('issue:abc-123')).toBe('issue_abc_123')
  })
})

describe('syntheticRelativePathForIssue', () => {
  it('uses user/project/issue layout', () => {
    const issue: LinearIssueNode = {
      id: 'i1',
      identifier: 'ENG-1',
      title: 'Fix it',
      url: 'https://linear.app',
      state: { name: 'Todo' },
      team: { key: 'E', name: 'Eng' },
      project: { id: 'p1', name: 'Mobile' },
      assignee: { id: 'u1', name: 'Alice' },
      creator: { id: 'u2', name: 'Bob' },
    }
    const p = syntheticRelativePathForIssue(issue, 'issue:i1')
    expect(p).toContain('Alice')
    expect(p).toContain('Mobile')
    expect(p).toContain('ENG-1')
    expect(p).toContain('issue_i1')
  })

  it('uses _unassigned when no assignee', () => {
    const issue: LinearIssueNode = {
      id: 'i2',
      identifier: 'X-2',
      title: 'T',
      url: 'https://linear.app',
      state: null,
      team: null,
      project: null,
      assignee: undefined,
      creator: undefined,
    }
    const p = syntheticRelativePathForIssue(issue, 'issue:i2')
    expect(p.startsWith('_unassigned/')).toBe(true)
  })
})

describe('syntheticRelativePathForProject', () => {
  it('uses _org prefix', () => {
    const proj: LinearProjectNode = {
      id: 'pid',
      name: 'Shop',
      slugId: 'shop',
      url: 'https://linear.app',
    }
    const p = syntheticRelativePathForProject(proj, 'project:pid')
    expect(p.startsWith('_org/')).toBe(true)
    expect(p).toContain('project_pid')
  })

  it('embeds team keys and organization in path segments for fff', () => {
    const proj: LinearProjectNode = {
      id: 'pid',
      name: 'Roadmap',
      slugId: 'rd',
      url: '',
      teamSummaries: [{ key: 'ENG', name: 'Engineering' }],
      organizationName: 'Acme',
    }
    const p = syntheticRelativePathForProject(proj, 'project:pid')
    expect(p).toContain('/ENG/')
    expect(p).toContain('/Acme/')
    expect(p.endsWith('/project--project_pid.txt')).toBe(true)
  })
})

describe('syntheticRelativePathForBar', () => {
  it('uses _bar prefix', () => {
    const p = syntheticRelativePathForBar({ projectName: 'Mobile', rowId: 'bar:xyz' })
    expect(p.startsWith('_bar/')).toBe(true)
  })
})
