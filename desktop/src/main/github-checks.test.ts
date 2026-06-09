import { describe, expect, it } from 'bun:test'
import {
  formatDurationLabel,
  mapPrChecksDetail,
  rowStatusFromCheckRun,
  rowStatusFromDeployment,
  rowStatusFromStatusContext,
  type GraphqlPrChecksNode,
} from './github-checks'

describe('rowStatusFromCheckRun', () => {
  it('maps in-flight statuses to pending', () => {
    for (const status of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED']) {
      expect(rowStatusFromCheckRun(status, null)).toBe('pending')
    }
  })

  it('maps completed + success to passing', () => {
    expect(rowStatusFromCheckRun('COMPLETED', 'SUCCESS')).toBe('passing')
  })

  it('maps failure-like conclusions to failing', () => {
    for (const conclusion of [
      'FAILURE',
      'TIMED_OUT',
      'STARTUP_FAILURE',
      'ACTION_REQUIRED',
      'CANCELLED',
    ]) {
      expect(rowStatusFromCheckRun('COMPLETED', conclusion)).toBe('failing')
    }
  })

  it('maps neutral to neutral', () => {
    expect(rowStatusFromCheckRun('COMPLETED', 'NEUTRAL')).toBe('neutral')
  })

  it('maps skipped / stale to skipped', () => {
    expect(rowStatusFromCheckRun('COMPLETED', 'SKIPPED')).toBe('skipped')
    expect(rowStatusFromCheckRun('COMPLETED', 'STALE')).toBe('skipped')
  })

  it('maps completed with null conclusion to neutral', () => {
    expect(rowStatusFromCheckRun('COMPLETED', null)).toBe('neutral')
  })

  it('accepts lower-case (REST-style) values', () => {
    expect(rowStatusFromCheckRun('completed', 'success')).toBe('passing')
    expect(rowStatusFromCheckRun('in_progress', null)).toBe('pending')
  })
})

describe('rowStatusFromStatusContext', () => {
  it('maps SUCCESS to passing', () => {
    expect(rowStatusFromStatusContext('SUCCESS')).toBe('passing')
  })
  it('maps FAILURE / ERROR to failing', () => {
    expect(rowStatusFromStatusContext('FAILURE')).toBe('failing')
    expect(rowStatusFromStatusContext('ERROR')).toBe('failing')
  })
  it('maps PENDING / EXPECTED to pending', () => {
    expect(rowStatusFromStatusContext('PENDING')).toBe('pending')
    expect(rowStatusFromStatusContext('EXPECTED')).toBe('pending')
  })
  it('falls back to neutral', () => {
    expect(rowStatusFromStatusContext('SOMETHING')).toBe('neutral')
  })
})

describe('rowStatusFromDeployment', () => {
  it('maps SUCCESS / ACTIVE to passing', () => {
    expect(rowStatusFromDeployment('SUCCESS')).toBe('passing')
    expect(rowStatusFromDeployment('ACTIVE')).toBe('passing')
  })
  it('maps ERROR / FAILURE to failing', () => {
    expect(rowStatusFromDeployment('ERROR')).toBe('failing')
    expect(rowStatusFromDeployment('FAILURE')).toBe('failing')
  })
  it('falls back to pending', () => {
    expect(rowStatusFromDeployment('IN_PROGRESS')).toBe('pending')
    expect(rowStatusFromDeployment(null)).toBe('pending')
  })
})

describe('formatDurationLabel', () => {
  it('returns undefined when a timestamp is missing', () => {
    expect(formatDurationLabel(null, '2024-01-01T00:00:06Z')).toBeUndefined()
    expect(formatDurationLabel('2024-01-01T00:00:00Z', undefined)).toBeUndefined()
  })
  it('formats sub-minute durations in seconds', () => {
    expect(formatDurationLabel('2024-01-01T00:00:00Z', '2024-01-01T00:00:06Z')).toBe('6s')
  })
  it('formats minute durations in minutes', () => {
    expect(formatDurationLabel('2024-01-01T00:00:00Z', '2024-01-01T00:01:00Z')).toBe('1m')
    expect(formatDurationLabel('2024-01-01T00:00:00Z', '2024-01-01T00:06:00Z')).toBe('6m')
  })
  it('returns undefined for negative durations', () => {
    expect(formatDurationLabel('2024-01-01T00:01:00Z', '2024-01-01T00:00:00Z')).toBeUndefined()
  })
})

function nodeWith(overrides: Partial<GraphqlPrChecksNode> = {}): GraphqlPrChecksNode {
  return {
    number: 7,
    title: 'A PR',
    body: 'body',
    url: 'https://github.com/o/r/pull/7',
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'feature',
    isCrossRepository: false,
    ...overrides,
  }
}

describe('mapPrChecksDetail', () => {
  it('derives total and failedCount from check rows', () => {
    const node = nodeWith({
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                contexts: {
                  totalCount: 3,
                  nodes: [
                    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
                    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
                    { __typename: 'StatusContext', context: 'ci/deploy', state: 'PENDING' },
                  ],
                },
              },
              deployments: { nodes: [] },
            },
          },
        ],
      },
    })
    const detail = mapPrChecksDetail(node, 2)
    expect(detail.total).toBe(3)
    expect(detail.failedCount).toBe(1)
    expect(detail.checks.map((c) => c.status)).toEqual(['passing', 'failing', 'pending'])
    expect(detail.commitsBehind).toBe(2)
    expect(detail.truncatedCount).toBe(0)
  })

  it('dedupes deployments by environment keeping the latest', () => {
    const node = nodeWith({
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: { contexts: { totalCount: 0, nodes: [] } },
              deployments: {
                nodes: [
                  { environment: 'prod', latestStatus: { state: 'ERROR' } },
                  { environment: 'prod', latestStatus: { state: 'SUCCESS', environmentUrl: 'https://prod' } },
                  { environment: 'staging', latestStatus: { state: 'SUCCESS' } },
                ],
              },
            },
          },
        ],
      },
    })
    const detail = mapPrChecksDetail(node, null)
    expect(detail.deployments).toHaveLength(2)
    const prod = detail.deployments.find((d) => d.environment === 'prod')
    expect(prod?.status).toBe('passing')
    expect(prod?.url).toBe('https://prod')
  })

  it('handles cross-repo (commitsBehind null) and empty contexts', () => {
    const node = nodeWith({
      isCrossRepository: true,
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: null,
              deployments: { nodes: [] },
            },
          },
        ],
      },
    })
    const detail = mapPrChecksDetail(node, null)
    expect(detail.commitsBehind).toBeNull()
    expect(detail.checks).toEqual([])
    expect(detail.total).toBe(0)
    expect(detail.failedCount).toBe(0)
  })

  it('reports truncatedCount when the rollup has more contexts than fetched', () => {
    const node = nodeWith({
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                contexts: {
                  totalCount: 102,
                  nodes: [
                    { __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
                    { __typename: 'CheckRun', name: 'b', status: 'COMPLETED', conclusion: 'SUCCESS' },
                  ],
                },
              },
              deployments: { nodes: [] },
            },
          },
        ],
      },
    })
    const detail = mapPrChecksDetail(node, 0)
    expect(detail.truncatedCount).toBe(100)
  })

  it('carries CheckRun appName + duration and StatusContext detailsUrl', () => {
    const node = nodeWith({
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                contexts: {
                  totalCount: 2,
                  nodes: [
                    {
                      __typename: 'CheckRun',
                      name: 'build',
                      status: 'COMPLETED',
                      conclusion: 'SUCCESS',
                      startedAt: '2024-01-01T00:00:00Z',
                      completedAt: '2024-01-01T00:00:06Z',
                      detailsUrl: 'https://details',
                      checkSuite: { app: { name: 'GitHub Actions' } },
                    },
                    {
                      __typename: 'StatusContext',
                      context: 'vercel',
                      state: 'SUCCESS',
                      targetUrl: 'https://vercel',
                    },
                  ],
                },
              },
              deployments: { nodes: [] },
            },
          },
        ],
      },
    })
    const detail = mapPrChecksDetail(node, 0)
    const [build, vercel] = detail.checks
    expect(build.appName).toBe('GitHub Actions')
    expect(build.durationLabel).toBe('6s')
    expect(build.detailsUrl).toBe('https://details')
    expect(vercel.appName).toBeUndefined()
    expect(vercel.detailsUrl).toBe('https://vercel')
  })

  it('normalizes PR state', () => {
    expect(mapPrChecksDetail(nodeWith({ state: 'MERGED' }), null).state).toBe('merged')
    expect(mapPrChecksDetail(nodeWith({ state: 'CLOSED' }), null).state).toBe('closed')
    expect(mapPrChecksDetail(nodeWith({ state: 'OPEN' }), null).state).toBe('open')
  })
})
