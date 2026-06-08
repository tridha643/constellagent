import { describe, expect, it } from 'bun:test'
import { GithubService } from './github-service'
import type { PrInfo } from '../shared/github-types'

// `mapPullRequest` is a private static; reach it via bracket access for the unit
// test (TypeScript `private` is compile-time only).
const mapPullRequest = (node: unknown): PrInfo =>
  (GithubService as unknown as { mapPullRequest: (n: unknown) => PrInfo }).mapPullRequest(node)

function baseNode(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    state: 'OPEN',
    title: 'docs(agents): document email-to-PR automation',
    url: 'https://github.com/owner/repo/pull/42',
    updatedAt: '2026-06-08T00:00:00Z',
    additions: 21,
    deletions: 3,
    author: { login: 'tridha643' },
    reviewDecision: null,
    mergeStateStatus: null,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    ...overrides,
  }
}

describe('GithubService.mapPullRequest', () => {
  it('maps authorLogin, additions, and deletions from the node', () => {
    const pr = mapPullRequest(baseNode())

    expect(pr.authorLogin).toBe('tridha643')
    expect(pr.additions).toBe(21)
    expect(pr.deletions).toBe(3)
    expect(pr.checkStatus).toBe('passing')
    expect(pr.state).toBe('open')
  })

  it('leaves authorLogin undefined when the author is missing', () => {
    const pr = mapPullRequest(baseNode({ author: null }))
    expect(pr.authorLogin).toBeUndefined()
  })

  it('passes additions/deletions through as undefined when absent', () => {
    const pr = mapPullRequest(baseNode({ additions: undefined, deletions: undefined }))
    expect(pr.additions).toBeUndefined()
    expect(pr.deletions).toBeUndefined()
  })
})
