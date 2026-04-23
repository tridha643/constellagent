import { describe, expect, it } from 'vitest'
import type { LinearIssueNode } from '../../linear/linear-api'
import { EMPTY_LINEAR_ISSUE_FILTERS } from '../../store/types'
import { groupIssuesByState } from './group-issues-by-state'

function issue(
  partial: Partial<LinearIssueNode> & { id: string; identifier: string },
): LinearIssueNode {
  return {
    id: partial.id,
    identifier: partial.identifier,
    title: partial.title ?? partial.identifier,
    url: partial.url ?? `https://linear.app/${partial.identifier}`,
    priority: partial.priority,
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt,
    state:
      'state' in partial ? partial.state : { name: 'Todo', type: 'unstarted' },
    team: partial.team ?? { key: 'ENG', name: 'Engineering' },
    project: partial.project,
    assignee: partial.assignee,
    creator: partial.creator,
  }
}

describe('groupIssuesByState', () => {
  it('returns an empty list when no issues', () => {
    expect(groupIssuesByState([], EMPTY_LINEAR_ISSUE_FILTERS)).toEqual([])
  })

  it('emits groups in canonical state-type order', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: 'a', identifier: 'ENG-1', state: { name: 'Done', type: 'completed' } }),
      issue({ id: 'b', identifier: 'ENG-2', state: { name: 'In Progress', type: 'started' } }),
      issue({ id: 'c', identifier: 'ENG-3', state: { name: 'Backlog', type: 'backlog' } }),
      issue({ id: 'd', identifier: 'ENG-4', state: { name: 'Todo', type: 'unstarted' } }),
    ]
    const groups = groupIssuesByState(issues, EMPTY_LINEAR_ISSUE_FILTERS)
    expect(groups.map((g) => g.stateType)).toEqual([
      'started',
      'unstarted',
      'backlog',
      'completed',
    ])
  })

  it('sorts by priority ascending within a bucket (urgent first, then 2,3,4,0,null)', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: 'n', identifier: 'ENG-N', priority: undefined }),
      issue({ id: '4', identifier: 'ENG-4', priority: 4 }),
      issue({ id: '1', identifier: 'ENG-1', priority: 1 }),
      issue({ id: '3', identifier: 'ENG-3', priority: 3 }),
      issue({ id: '0', identifier: 'ENG-0', priority: 0 }),
      issue({ id: '2', identifier: 'ENG-2', priority: 2 }),
    ]
    const [group] = groupIssuesByState(issues, EMPTY_LINEAR_ISSUE_FILTERS)
    expect(group!.issues.map((i) => i.identifier)).toEqual([
      'ENG-1',
      'ENG-2',
      'ENG-3',
      'ENG-4',
      'ENG-0',
      'ENG-N',
    ])
  })

  it('tiebreaks equal priorities by updatedAt descending', () => {
    const issues: LinearIssueNode[] = [
      issue({
        id: 'old',
        identifier: 'ENG-OLD',
        priority: 2,
        updatedAt: '2024-01-01T00:00:00Z',
      }),
      issue({
        id: 'mid',
        identifier: 'ENG-MID',
        priority: 2,
        updatedAt: '2024-06-01T00:00:00Z',
      }),
      issue({
        id: 'new',
        identifier: 'ENG-NEW',
        priority: 2,
        updatedAt: '2025-01-01T00:00:00Z',
      }),
    ]
    const [group] = groupIssuesByState(issues, EMPTY_LINEAR_ISSUE_FILTERS)
    expect(group!.issues.map((i) => i.identifier)).toEqual([
      'ENG-NEW',
      'ENG-MID',
      'ENG-OLD',
    ])
  })

  it('drops issues with null or unknown state', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: 'null', identifier: 'ENG-NULL', state: null }),
      issue({
        id: 'unknown',
        identifier: 'ENG-UNK',
        state: { name: 'Custom', type: 'custom' },
      }),
      issue({ id: 'ok', identifier: 'ENG-OK' }),
    ]
    const groups = groupIssuesByState(issues, EMPTY_LINEAR_ISSUE_FILTERS)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.issues.map((i) => i.identifier)).toEqual(['ENG-OK'])
  })

  it('normalizes legacy "cancelled" spelling into the "canceled" bucket', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: 'c', identifier: 'ENG-C', state: { name: 'Cancelled', type: 'cancelled' } }),
    ]
    const [group] = groupIssuesByState(issues, EMPTY_LINEAR_ISSUE_FILTERS)
    expect(group?.stateType).toBe('canceled')
  })

  it('skips empty buckets', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: 'a', identifier: 'ENG-1', state: { name: 'Todo', type: 'unstarted' } }),
    ]
    const groups = groupIssuesByState(issues, EMPTY_LINEAR_ISSUE_FILTERS)
    expect(groups.map((g) => g.stateType)).toEqual(['unstarted'])
  })

  it('applies priority filter', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: '1', identifier: 'ENG-1', priority: 1 }),
      issue({ id: '2', identifier: 'ENG-2', priority: 2 }),
      issue({ id: '3', identifier: 'ENG-3', priority: 3 }),
    ]
    const groups = groupIssuesByState(issues, {
      ...EMPTY_LINEAR_ISSUE_FILTERS,
      priorities: [1, 3],
    })
    expect(groups[0]!.issues.map((i) => i.identifier)).toEqual(['ENG-1', 'ENG-3'])
  })

  it('applies state-type filter', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: 'a', identifier: 'ENG-1', state: { name: 'In Progress', type: 'started' } }),
      issue({ id: 'b', identifier: 'ENG-2', state: { name: 'Todo', type: 'unstarted' } }),
    ]
    const groups = groupIssuesByState(issues, {
      ...EMPTY_LINEAR_ISSUE_FILTERS,
      stateTypes: ['started'],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.stateType).toBe('started')
  })

  it('applies team filter by key', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: 'a', identifier: 'ENG-1', team: { key: 'ENG', name: 'Engineering' } }),
      issue({ id: 'b', identifier: 'DES-1', team: { key: 'DES', name: 'Design' } }),
    ]
    const groups = groupIssuesByState(issues, {
      ...EMPTY_LINEAR_ISSUE_FILTERS,
      teamKeys: ['DES'],
    })
    expect(groups[0]!.issues.map((i) => i.identifier)).toEqual(['DES-1'])
  })

  it('applies text filter on identifier + title, case-insensitive', () => {
    const issues: LinearIssueNode[] = [
      issue({ id: 'a', identifier: 'ENG-10', title: 'Migrate storage layer' }),
      issue({ id: 'b', identifier: 'ENG-11', title: 'Fix login redirect' }),
      issue({ id: 'c', identifier: 'ENG-12', title: 'Upgrade deps' }),
    ]
    const idMatch = groupIssuesByState(issues, {
      ...EMPTY_LINEAR_ISSUE_FILTERS,
      text: 'eng-11',
    })
    expect(idMatch[0]!.issues.map((i) => i.identifier)).toEqual(['ENG-11'])

    const titleMatch = groupIssuesByState(issues, {
      ...EMPTY_LINEAR_ISSUE_FILTERS,
      text: 'STORAGE',
    })
    expect(titleMatch[0]!.issues.map((i) => i.identifier)).toEqual(['ENG-10'])
  })
})
