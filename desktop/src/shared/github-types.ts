export type PrState = 'open' | 'merged' | 'closed'

export type CheckStatus = 'pending' | 'passing' | 'failing' | 'none'

export type GithubLookupError = 'gh_not_installed' | 'not_authenticated' | 'not_github_repo'

export interface PrInfo {
  number: number
  state: PrState
  title: string
  url: string
  checkStatus: CheckStatus
  hasPendingComments: boolean
  pendingCommentCount: number
  isBlockedByCi: boolean
  isApproved: boolean
  isChangesRequested: boolean
  updatedAt: string
  /** PR author login (for the workspace bar's PR-mode author + avatar). */
  authorLogin?: string
  /** Aggregate diff additions reported by the PR (PR-mode `+N`). */
  additions?: number
  /** Aggregate diff deletions reported by the PR (PR-mode `-N`). */
  deletions?: number
}

export interface PullRequestRepoRef {
  owner: string
  name: string
  url?: string
}

export interface PullRequestHeadMetadata {
  baseRefName: string
  headRefName: string
  headRepository?: PullRequestRepoRef
  isCrossRepository: boolean
}

export interface PrLookupResult {
  available: boolean
  error?: GithubLookupError
  data: Record<string, PrInfo | null>
}

export interface OpenPrInfo extends PrInfo {
  headRefName: string
  baseRefName: string
  headRepository?: PullRequestRepoRef
  isCrossRepository: boolean
  authorLogin?: string
  assigneeLogins?: string[]
  isAssignedToViewer?: boolean
  reviewRequestLogins?: string[]
  isReviewRequestedFromViewer?: boolean
}

export interface ResolvedPrInfo extends PullRequestHeadMetadata {
  branch: string
  title: string
  number: number
  url: string
}

export interface LinkedPullRequest {
  number: number
  url: string
  title: string
  baseRefName: string
  headRefName: string
  headRepository?: PullRequestRepoRef
  pushRemote: string
  pushRef: string
}

export interface ListOpenPrsResult {
  available: boolean
  error?: GithubLookupError
  data: OpenPrInfo[]
}

/** Normalized per-row status for the Checks tab (CheckRun/StatusContext/Deployment all map into this). */
export type CheckRowStatus = 'passing' | 'failing' | 'pending' | 'skipped' | 'neutral'

export interface PrCheckRow {
  /** Stable within a single fetch: `${typename}:${name}:${i}`. */
  id: string
  /** CheckRun.name | StatusContext.context */
  name: string
  /** checkSuite.app.name (GitHub Actions, Vercel, …) when known. */
  appName?: string
  status: CheckRowStatus
  /** `6s` / `1m` / `6m`, computed main-side from startedAt/completedAt. */
  durationLabel?: string
  /** CheckRun.detailsUrl | StatusContext.targetUrl */
  detailsUrl?: string
}

export interface PrDeploymentRow {
  id: string
  environment: string
  status: CheckRowStatus
  /** latestStatus.environmentUrl | logUrl */
  url?: string
}

export interface PrChecksDetail {
  number: number
  title: string
  body: string
  url: string
  state: PrState
  baseRefName: string
  headRefName: string
  /** Total number of check rows. */
  total: number
  /** Count of rows whose status is `failing`. */
  failedCount: number
  checks: PrCheckRow[]
  deployments: PrDeploymentRow[]
  /** Commits the PR head is behind its base, via Ref.compare. `null` when cross-repo / unknown. */
  commitsBehind: number | null
  /** When the rollup reported more contexts than we fetched (first:100 cap); 0 otherwise. */
  truncatedCount: number
}

export interface PrChecksResult {
  available: boolean
  error?: GithubLookupError
  data: PrChecksDetail | null
}
