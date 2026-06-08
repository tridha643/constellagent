import { describe, expect, it } from 'bun:test'
import { GithubService } from './github-service'
import type { OpenPrInfo, PrInfo } from '../shared/github-types'

// `mapPullRequest` is a private static; reach it via bracket access for the unit
// test (TypeScript `private` is compile-time only).
const mapPullRequest = (node: unknown): PrInfo =>
  (GithubService as unknown as { mapPullRequest: (n: unknown) => PrInfo }).mapPullRequest(node)
const mapOpenPullRequest = (
  node: unknown,
  viewerLogin: string,
  reviewRequestedNumbers: ReadonlySet<number> = new Set(),
): OpenPrInfo =>
  (GithubService as unknown as {
    mapOpenPullRequest: (
      repoInfo: { owner: string; name: string },
      n: unknown,
      viewerLogin: string,
      reviewRequestedNumbers?: ReadonlySet<number>,
    ) => OpenPrInfo
  }).mapOpenPullRequest(
    { owner: 'owner', name: 'repo' },
    node,
    viewerLogin,
    reviewRequestedNumbers,
  )
const cloneOpenPrs = (data: OpenPrInfo[]): OpenPrInfo[] =>
  (GithubService as unknown as { cloneOpenPrs: (data: OpenPrInfo[]) => OpenPrInfo[] })
    .cloneOpenPrs(data)

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

describe('GithubService.mapOpenPullRequest', () => {
  it('maps assignees and flags PRs assigned to the viewer case-insensitively', () => {
    const pr = mapOpenPullRequest(
      baseNode({
        headRefName: 'feature-branch',
        baseRefName: 'main',
        assignees: {
          nodes: [
            { login: 'alice' },
            { login: 'TriDha643' },
            { login: '  ' },
            { login: null },
          ],
        },
      }),
      'tridha643',
    )

    expect(pr.assigneeLogins).toEqual(['alice', 'TriDha643'])
    expect(pr.isAssignedToViewer).toBe(true)
  })

  it('leaves isAssignedToViewer false when the viewer is missing or unassigned', () => {
    const assignedPr = mapOpenPullRequest(
      baseNode({ assignees: { nodes: [{ login: 'alice' }] } }),
      '',
    )
    const unassignedPr = mapOpenPullRequest(
      baseNode({ assignees: { nodes: [{ login: 'alice' }] } }),
      'tridha643',
    )

    expect(assignedPr.isAssignedToViewer).toBe(false)
    expect(unassignedPr.isAssignedToViewer).toBe(false)
  })

  it('maps user review requests and flags PRs requested from the viewer case-insensitively', () => {
    const pr = mapOpenPullRequest(
      baseNode({
        reviewRequests: {
          nodes: [
            { requestedReviewer: { __typename: 'User', login: 'alice' } },
            { requestedReviewer: { __typename: 'User', login: 'TriDha643' } },
            { requestedReviewer: { __typename: 'Team', login: 'reviewers' } },
            { requestedReviewer: { __typename: 'User', login: '  ' } },
            { requestedReviewer: null },
          ],
        },
      }),
      'tridha643',
    )

    expect(pr.reviewRequestLogins).toEqual(['alice', 'TriDha643'])
    expect(pr.isReviewRequestedFromViewer).toBe(true)
  })

  it('leaves isReviewRequestedFromViewer false when the viewer is missing or not requested', () => {
    const requestedPr = mapOpenPullRequest(
      baseNode({
        reviewRequests: {
          nodes: [{ requestedReviewer: { __typename: 'User', login: 'alice' } }],
        },
      }),
      '',
    )
    const unrequestedPr = mapOpenPullRequest(
      baseNode({
        reviewRequests: {
          nodes: [{ requestedReviewer: { __typename: 'User', login: 'alice' } }],
        },
      }),
      'tridha643',
    )

    expect(requestedPr.isReviewRequestedFromViewer).toBe(false)
    expect(unrequestedPr.isReviewRequestedFromViewer).toBe(false)
  })

  it('flags review-requested PRs from the GitHub search result set', () => {
    const pr = mapOpenPullRequest(
      baseNode({
        reviewRequests: {
          nodes: [{ requestedReviewer: { __typename: 'Team', login: 'reviewers' } }],
        },
      }),
      '',
      new Set([42]),
    )

    expect(pr.reviewRequestLogins).toEqual([])
    expect(pr.isReviewRequestedFromViewer).toBe(true)
  })
})

describe('GithubService.cloneOpenPrs', () => {
  it('deep-copies reviewer arrays for cached open PR rows', () => {
    const source = [
      {
        ...mapOpenPullRequest(
          baseNode({
            assignees: { nodes: [{ login: 'alice' }] },
            reviewRequests: {
              nodes: [{ requestedReviewer: { __typename: 'User', login: 'alice' } }],
            },
          }),
          'alice',
        ),
      },
    ]

    const cloned = cloneOpenPrs(source)
    cloned[0].assigneeLogins?.push('bob')
    cloned[0].reviewRequestLogins?.push('bob')

    expect(source[0].assigneeLogins).toEqual(['alice'])
    expect(cloned[0].assigneeLogins).toEqual(['alice', 'bob'])
    expect(source[0].reviewRequestLogins).toEqual(['alice'])
    expect(cloned[0].reviewRequestLogins).toEqual(['alice', 'bob'])
  })
})
