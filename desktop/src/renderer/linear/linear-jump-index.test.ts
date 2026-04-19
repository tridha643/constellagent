import { describe, expect, it } from 'vitest'
import {
  applyLinearJumpScope,
  buildLinearJumpIndex,
  filterAndSortJumpRows,
  fuzzyMatchSubsequence,
  compareJumpRowsForQuickOpen,
  issueActivityMs,
  LINEAR_JUMP_RESULT_LIMIT,
  linearJumpPayloadId,
  mergeLinearJumpRows,
  rankJumpRowsFromFffPaths,
  type LinearJumpRow,
} from './linear-jump-index'
import type { LinearIssueNode, LinearProjectNode } from './linear-api'

const issue = (partial: Partial<LinearIssueNode> & Pick<LinearIssueNode, 'id' | 'identifier' | 'title'>): LinearIssueNode => ({
  url: 'https://linear.app/x/1',
  priority: 3,
  createdAt: new Date('2024-05-01T00:00:00Z').toISOString(),
  updatedAt: new Date('2024-06-01T00:00:00Z').toISOString(),
  state: { name: 'Todo', type: 'unstarted' },
  team: { key: 'ENG', name: 'Engineering' },
  project: null,
  assignee: null,
  creator: null,
  ...partial,
})

describe('buildLinearJumpIndex', () => {
  it('dedupes issues that appear in both assigned and created', () => {
    const i = issue({ id: 'same', identifier: 'X-1', title: 'Dup' })
    const rows = buildLinearJumpIndex({
      barEntries: [],
      projectNameById: new Map(),
      assigned: [i],
      created: [i],
      projects: [],
    })
    const issueRows = rows.filter((r) => r.kind === 'issue')
    expect(issueRows.length).toBe(1)
    expect(issueRows[0]?.subtitle).toContain('Assigned')
  })

  it('includes bar note text in searchBlob', () => {
    const rows = buildLinearJumpIndex({
      barEntries: [{ linearProjectId: 'p1', note: 'ship widget' }],
      projectNameById: new Map([['p1', 'Alpha']]),
      assigned: [],
      created: [],
      projects: [],
    })
    const bar = rows.find((r) => r.kind === 'bar')
    expect(bar?.searchBlob).toContain('ship widget')
    expect(bar?.searchBlob).toContain('alpha')
  })

  it('orders bar before issues in index', () => {
    const rows = buildLinearJumpIndex({
      barEntries: [{ linearProjectId: 'p1' }],
      projectNameById: new Map([['p1', 'Zed']]),
      assigned: [issue({ id: 'i1', identifier: 'A-1', title: 'T' })],
      created: [],
      projects: [{ id: 'p2', name: 'Proj', slugId: 'slug', url: '' } satisfies LinearProjectNode],
    })
    expect(rows[0]?.kind).toBe('bar')
    expect(rows.some((r) => r.kind === 'issue')).toBe(true)
    expect(rows.some((r) => r.kind === 'project')).toBe(true)
  })
})

describe('applyLinearJumpScope', () => {
  it('with only project, keeps issues and rows for that project', () => {
    const rows = buildLinearJumpIndex({
      barEntries: [{ linearProjectId: 'p1' }],
      projectNameById: new Map([['p1', 'BarProj']]),
      assigned: [
        issue({
          id: 'i1',
          identifier: 'A-1',
          title: 'In P1',
          project: { id: 'p1', name: 'P1' },
        }),
      ],
      created: [
        issue({
          id: 'i2',
          identifier: 'B-1',
          title: 'In P2',
          project: { id: 'p2', name: 'P2' },
        }),
      ],
      projects: [{ id: 'p1', name: 'P1', slugId: 'p1', url: '' }],
    })
    const scoped = applyLinearJumpScope(rows, { projectId: 'p1', userId: null })
    expect(scoped.some((r) => r.id === 'issue:i1')).toBe(true)
    expect(scoped.some((r) => r.id === 'issue:i2')).toBe(false)
    expect(scoped.some((r) => r.kind === 'bar')).toBe(true)
    expect(scoped.some((r) => r.kind === 'project' && r.projectId === 'p1')).toBe(true)
  })

  it('with only user, keeps matching issues only', () => {
    const rows = buildLinearJumpIndex({
      barEntries: [{ linearProjectId: 'p1' }],
      projectNameById: new Map(),
      assigned: [
        issue({
          id: 'i1',
          identifier: 'A-1',
          title: 'T1',
          assignee: { id: 'u1', name: 'Alice' },
        }),
      ],
      created: [
        issue({
          id: 'i2',
          identifier: 'B-1',
          title: 'T2',
          creator: { id: 'u2', name: 'Bob' },
        }),
      ],
      projects: [],
    })
    const scoped = applyLinearJumpScope(rows, { projectId: null, userId: 'u2' })
    expect(scoped.every((r) => r.kind === 'issue')).toBe(true)
    expect(scoped.some((r) => r.id === 'issue:i2')).toBe(true)
    expect(scoped.some((r) => r.kind === 'bar')).toBe(false)
  })

  it('with user and project, keeps non-issue rows for project', () => {
    const rows = buildLinearJumpIndex({
      barEntries: [{ linearProjectId: 'p1' }],
      projectNameById: new Map([['p1', 'Z']]),
      assigned: [
        issue({
          id: 'i1',
          identifier: 'A-1',
          title: 'T',
          project: { id: 'p1', name: 'P' },
          assignee: { id: 'u9', name: 'Zed' },
        }),
      ],
      created: [],
      projects: [{ id: 'p1', name: 'P', slugId: 'p1', url: '' }],
    })
    const scoped = applyLinearJumpScope(rows, { projectId: 'p1', userId: 'u9' })
    expect(scoped.some((r) => r.kind === 'project' && r.projectId === 'p1')).toBe(true)
    expect(scoped.some((r) => r.kind === 'bar')).toBe(true)
  })
})

describe('Cmd+F ranking (time → active → relevance)', () => {
  it('issueActivityMs is max of created and updated', () => {
    const row: LinearJumpRow = {
      id: 'issue:x',
      kind: 'issue',
      title: 't',
      subtitle: '',
      searchBlob: 'x',
      createdAtMs: Date.parse('2026-01-01T00:00:00Z'),
      updatedAtMs: Date.parse('2020-01-01T00:00:00Z'),
    }
    expect(issueActivityMs(row)).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('rankJumpRowsFromFffPaths: equal fff score prefers newer activity', () => {
    const older: LinearJumpRow = {
      id: 'issue:old',
      kind: 'issue',
      title: 'Same title',
      subtitle: '',
      searchBlob: 'same',
      fffRelativePath: 'u/p/old',
      updatedAtMs: Date.parse('2020-01-01T00:00:00Z'),
      issueStateType: 'started',
    }
    const newer: LinearJumpRow = {
      id: 'issue:new',
      kind: 'issue',
      title: 'Same title',
      subtitle: '',
      searchBlob: 'same',
      fffRelativePath: 'u/p/new',
      updatedAtMs: Date.parse('2025-06-01T00:00:00Z'),
      issueStateType: 'started',
    }
    const m = new Map<string, LinearJumpRow>([
      [older.fffRelativePath!, older],
      [newer.fffRelativePath!, newer],
    ])
    const out = rankJumpRowsFromFffPaths([older.fffRelativePath!, newer.fffRelativePath!], [100, 100], m)
    expect(out[0]?.id).toBe('issue:new')
  })

  it('rankJumpRowsFromFffPaths: same activity and relevance prefers active over completed', () => {
    const ts = Date.parse('2025-01-01T00:00:00Z')
    const done: LinearJumpRow = {
      id: 'issue:done',
      kind: 'issue',
      title: 'A',
      subtitle: '',
      searchBlob: 'a',
      fffRelativePath: 'u/p/done',
      updatedAtMs: ts,
      issueStateType: 'completed',
    }
    const active: LinearJumpRow = {
      id: 'issue:act',
      kind: 'issue',
      title: 'B',
      subtitle: '',
      searchBlob: 'b',
      fffRelativePath: 'u/p/act',
      updatedAtMs: ts,
      issueStateType: 'started',
    }
    const m = new Map<string, LinearJumpRow>([
      [done.fffRelativePath!, done],
      [active.fffRelativePath!, active],
    ])
    const out = rankJumpRowsFromFffPaths([done.fffRelativePath!, active.fffRelativePath!], [50, 50], m)
    expect(out[0]?.id).toBe('issue:act')
  })

  it('compareJumpRowsForQuickOpen: same time and relevance orders active before completed', () => {
    const ts = Date.parse('2025-01-01T00:00:00Z')
    const active: LinearJumpRow = {
      id: 'issue:a',
      kind: 'issue',
      title: 'x',
      subtitle: '',
      searchBlob: 'x',
      updatedAtMs: ts,
      issueStateType: 'started',
    }
    const done: LinearJumpRow = { ...active, id: 'issue:d', issueStateType: 'completed' }
    expect(compareJumpRowsForQuickOpen({ row: active, relevance: 10 }, { row: done, relevance: 10 })).toBeLessThan(0)
  })
})

describe('filterAndSortJumpRows', () => {
  it('caps empty query to LINEAR_JUMP_RESULT_LIMIT', () => {
    const rows = Array.from({ length: LINEAR_JUMP_RESULT_LIMIT + 20 }, (_, n) => ({
      id: `project:${n}`,
      kind: 'project' as const,
      title: `P${n}`,
      subtitle: '',
      searchBlob: `p${n}`,
    }))
    const out = filterAndSortJumpRows(rows, '')
    expect(out.length).toBe(LINEAR_JUMP_RESULT_LIMIT)
  })

  it('filters by subsequence', () => {
    const rows = buildLinearJumpIndex({
      barEntries: [],
      projectNameById: new Map(),
      assigned: [issue({ id: '1', identifier: 'FOO-12', title: 'Alpha beta' })],
      created: [],
      projects: [{ id: 'p', name: 'Gamma', slugId: 'g', url: '' }],
    })
    const out = filterAndSortJumpRows(rows, 'fb')
    expect(out.some((r) => r.title === 'Alpha beta')).toBe(true)
    const out2 = filterAndSortJumpRows(rows, 'zzz')
    expect(out2.length).toBe(0)
  })
})

describe('mergeLinearJumpRows', () => {
  it('keeps baseline row when ids collide', () => {
    const base: LinearJumpRow = {
      id: 'issue:same',
      kind: 'issue',
      title: 'First',
      subtitle: '',
      searchBlob: 'x',
    }
    const extra: LinearJumpRow = {
      id: 'issue:same',
      kind: 'issue',
      title: 'Second',
      subtitle: '',
      searchBlob: 'y',
    }
    const m = mergeLinearJumpRows([base], [extra])
    expect(m).toHaveLength(1)
    expect(m[0]?.title).toBe('First')
  })
})

describe('linearJumpPayloadId', () => {
  it('returns substring after first colon', () => {
    expect(linearJumpPayloadId({ id: 'issue:abc:def', kind: 'issue', title: '', subtitle: '', searchBlob: '' })).toBe(
      'abc:def',
    )
  })
})

describe('fuzzyMatchSubsequence', () => {
  it('returns empty array for empty query', () => {
    expect(fuzzyMatchSubsequence('', 'hello')).toEqual([])
  })
})
