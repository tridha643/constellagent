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
