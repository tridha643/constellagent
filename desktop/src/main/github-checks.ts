import type {
  CheckRowStatus,
  PrChecksDetail,
  PrCheckRow,
  PrDeploymentRow,
  PrState,
} from '../shared/github-types'

/**
 * Pure mappers + response normalization for the per-workspace Checks tab.
 * Kept separate from `github-service.ts` so the status/duration logic is unit-testable
 * without spawning `gh` or hitting the GraphQL endpoint.
 */

// ── Raw GraphQL node shapes (the dedicated PR-checks query) ──

export interface GraphqlCheckContextNode {
  __typename?: string
  // CheckRun
  name?: string | null
  status?: string | null
  conclusion?: string | null
  startedAt?: string | null
  completedAt?: string | null
  detailsUrl?: string | null
  checkSuite?: { app?: { name?: string | null } | null } | null
  // StatusContext
  context?: string | null
  state?: string | null
  description?: string | null
  targetUrl?: string | null
  createdAt?: string | null
}

export interface GraphqlDeploymentNode {
  environment?: string | null
  state?: string | null
  createdAt?: string | null
  latestStatus?: {
    state?: string | null
    environmentUrl?: string | null
    logUrl?: string | null
  } | null
}

export interface GraphqlPrChecksNode {
  number: number
  title?: string | null
  body?: string | null
  url?: string | null
  state?: string | null
  baseRefName?: string | null
  headRefName?: string | null
  isCrossRepository?: boolean | null
  commits?: {
    nodes?: Array<{
      commit?: {
        statusCheckRollup?: {
          contexts?: {
            totalCount?: number | null
            nodes?: GraphqlCheckContextNode[]
          } | null
        } | null
        deployments?: {
          nodes?: GraphqlDeploymentNode[]
        } | null
      } | null
    }>
  } | null
}

// ── Status normalization ──

/** CheckRun.status + conclusion → row status. Accepts GraphQL upper-case or REST lower-case. */
export function rowStatusFromCheckRun(
  status: string | null | undefined,
  conclusion: string | null | undefined,
): CheckRowStatus {
  const s = (status ?? '').toLowerCase()
  // Anything not completed is still running/queued.
  if (s !== 'completed') return 'pending'
  const c = (conclusion ?? '').toLowerCase()
  switch (c) {
    case 'success':
      return 'passing'
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
    case 'action_required':
    case 'cancelled':
      return 'failing'
    case 'skipped':
    case 'stale':
      return 'skipped'
    case 'neutral':
      return 'neutral'
    default:
      // completed with no/unknown conclusion
      return 'neutral'
  }
}

/** StatusContext.state → row status. */
export function rowStatusFromStatusContext(state: string | null | undefined): CheckRowStatus {
  const s = (state ?? '').toUpperCase()
  switch (s) {
    case 'SUCCESS':
      return 'passing'
    case 'FAILURE':
    case 'ERROR':
      return 'failing'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'neutral'
  }
}

/** Deployment latestStatus.state (or deployment.state) → row status. */
export function rowStatusFromDeployment(state: string | null | undefined): CheckRowStatus {
  const s = (state ?? '').toUpperCase()
  if (s === 'SUCCESS' || s === 'ACTIVE') return 'passing'
  if (s === 'ERROR' || s === 'FAILURE') return 'failing'
  return 'pending'
}

/** `6s` / `1m` / `6m`, or undefined when timestamps are missing/invalid. */
export function formatDurationLabel(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): string | undefined {
  if (!startedAt || !completedAt) return undefined
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 0) return undefined
  if (seconds < 60) return `${seconds}s`
  return `${Math.round(seconds / 60)}m`
}

function normalizePrState(state: string | null | undefined): PrState {
  const s = (state ?? '').toLowerCase()
  return s === 'merged' || s === 'closed' ? s : 'open'
}

// ── Row mapping ──

function mapCheckContext(node: GraphqlCheckContextNode, index: number): PrCheckRow | null {
  const typename = node.__typename ?? ''
  if (typename === 'CheckRun') {
    const name = node.name?.trim() || 'check'
    return {
      id: `CheckRun:${name}:${index}`,
      name,
      appName: node.checkSuite?.app?.name?.trim() || undefined,
      status: rowStatusFromCheckRun(node.status, node.conclusion),
      durationLabel: formatDurationLabel(node.startedAt, node.completedAt),
      detailsUrl: node.detailsUrl?.trim() || undefined,
    }
  }
  if (typename === 'StatusContext') {
    const name = node.context?.trim() || 'status'
    return {
      id: `StatusContext:${name}:${index}`,
      name,
      // StatusContext carries no app or duration.
      status: rowStatusFromStatusContext(node.state),
      detailsUrl: node.targetUrl?.trim() || undefined,
    }
  }
  return null
}

/** Dedupe deployments by environment, keeping the latest (last in `last:N` order, or newest createdAt). */
function mapDeployments(nodes: GraphqlDeploymentNode[]): PrDeploymentRow[] {
  const byEnv = new Map<string, PrDeploymentRow>()
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const environment = node.environment?.trim()
    if (!environment) continue
    const status = rowStatusFromDeployment(node.latestStatus?.state ?? node.state)
    const url = node.latestStatus?.environmentUrl?.trim() || node.latestStatus?.logUrl?.trim() || undefined
    // `deployments(last:20)` returns oldest→newest; later entries overwrite earlier per env.
    byEnv.set(environment, {
      id: `Deployment:${environment}`,
      environment,
      status,
      url,
    })
  }
  return Array.from(byEnv.values())
}

/**
 * Map the raw PR node into the renderer-facing detail. `commitsBehind` is resolved
 * separately (compare query) and threaded in; pass `null` for cross-repo / unknown.
 */
export function mapPrChecksDetail(
  pr: GraphqlPrChecksNode,
  commitsBehind: number | null,
): PrChecksDetail {
  const commit = pr.commits?.nodes?.[0]?.commit
  const rollup = commit?.statusCheckRollup
  const contextNodes = rollup?.contexts?.nodes ?? []
  const totalCount = rollup?.contexts?.totalCount ?? contextNodes.length

  const checks: PrCheckRow[] = []
  for (let i = 0; i < contextNodes.length; i++) {
    const row = mapCheckContext(contextNodes[i], i)
    if (row) checks.push(row)
  }

  const deployments = mapDeployments(commit?.deployments?.nodes ?? [])
  const failedCount = checks.filter((c) => c.status === 'failing').length
  const truncatedCount = Math.max(0, totalCount - contextNodes.length)

  return {
    number: pr.number,
    title: pr.title ?? '',
    body: pr.body ?? '',
    url: pr.url ?? '',
    state: normalizePrState(pr.state),
    baseRefName: pr.baseRefName?.trim() || '',
    headRefName: pr.headRefName?.trim() || '',
    total: checks.length,
    failedCount,
    checks,
    deployments,
    commitsBehind,
    truncatedCount,
  }
}
