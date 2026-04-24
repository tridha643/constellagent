import { execFile } from 'child_process'
import { promisify } from 'util'
import type {
  PrInfo,
  PrLookupResult,
  CheckStatus,
  PrState,
  OpenPrInfo,
  ListOpenPrsResult,
} from '../shared/github-types'
import { parseGithubUrl } from '../shared/github-url'
import type { GithubRepoInfo } from '../shared/github-url'
import type { GithubCloneRepoSuggestion } from '../shared/github-clone-suggestions'

const execFileAsync = promisify(execFile)

interface GraphqlPullRequestNode {
  number: number
  state: string
  title: string
  url: string
  updatedAt: string
  headRefName?: string | null
  author?: {
    login?: string | null
  } | null
  reviewDecision?: string | null
  mergeStateStatus?: string | null
  commits?: {
    nodes?: Array<{
      commit?: {
        statusCheckRollup?: {
          state?: string
        } | null
      }
    }>
  }
}

interface GraphqlConnection {
  nodes?: GraphqlPullRequestNode[]
}

interface GraphqlResponse {
  data?: {
    repository?: Record<string, GraphqlConnection>
  }
  errors?: Array<{ message?: string }>
}

interface GraphqlOpenPrListResponse {
  data?: {
    repository?: {
      pullRequests?: {
        nodes?: GraphqlPullRequestNode[]
      }
    }
  }
  errors?: Array<{ message?: string }>
}

interface GraphqlReviewThreadsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: Array<{ isResolved?: boolean }>
          pageInfo?: {
            hasNextPage?: boolean
            endCursor?: string | null
          }
        }
      }
    }
  }
  errors?: Array<{ message?: string }>
}

interface GraphqlPrReviewCommentsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: Array<{
            id: string
            isResolved: boolean
            path: string
            line: number | null
            startLine: number | null
            diffSide: string
            comments: {
              nodes: Array<{
                id: string
                body: string
                author?: { login?: string | null } | null
                createdAt: string
              }>
            }
          }>
        }
      }
    }
  }
  errors?: Array<{ message?: string }>
}

export interface PrReviewComment {
  id: string
  threadId: string
  filePath: string
  line: number | null
  startLine: number | null
  diffSide: 'LEFT' | 'RIGHT'
  body: string
  author: string
  createdAt: string
  resolved: boolean
}

interface RepoResponseCache {
  data: Record<string, PrInfo | null>
}

interface OpenPrListCache {
  fetchedAt: number
  data: OpenPrInfo[]
}

interface UnresolvedThreadCacheEntry {
  count: number
  fetchedAt: number
}

class GithubAuthError extends Error {}

function ghErrorMessage(err: unknown, fallback: string): string {
  const stderr =
    typeof err === 'object' && err !== null && 'stderr' in err
      ? String((err as { stderr?: unknown }).stderr ?? '')
      : ''
  const stdout =
    typeof err === 'object' && err !== null && 'stdout' in err
      ? String((err as { stdout?: unknown }).stdout ?? '')
      : ''
  const combined = `${stderr}\n${stdout}`.trim()
  const message = combined || (err instanceof Error ? err.message : String(err || ''))

  if (!message) return fallback
  if (message.includes('not logged into any GitHub hosts')) return 'GitHub CLI is not authenticated.'
  if (message.includes('already exists')) return 'A pull request already exists for this branch.'
  if (message.includes('No commits between')) return 'There are no commits to open in a pull request.'
  if (message.includes('is in clean status')) return 'There are no local commits to push.'
  if (message.includes('pull request is in state')) return 'Only closed pull requests can be reopened.'
  if (message.includes('was already merged')) return 'Merged pull requests cannot be reopened.'

  const cleaned = message
    .split('\n')
    .map((line) => line.replace(/^gh:\s*/, '').trim())
    .filter(Boolean)
  return cleaned[0] || fallback
}

function parsePrUrl(raw: string): { url: string; number: number | null } | null {
  const url = raw
    .split(/\s+/)
    .map((part) => part.trim())
    .find((part) => /^https?:\/\//.test(part))
  if (!url) return null
  const number = Number(url.match(/\/pull\/(\d+)(?:$|[?#/])/i)?.[1] ?? '')
  return { url, number: Number.isFinite(number) ? number : null }
}

export class GithubService {
  private static AUTH_TOKEN_REFRESH_MS = 60_000
  private static OPEN_PR_LIST_LIMIT = 50
  private static OPEN_PR_LIST_CACHE_MS = 25_000
  private static UNRESOLVED_THREAD_CACHE_TTL_MS = 30_000
  private static ghAvailable: boolean | null = null
  private static repoInfoCache = new Map<string, GithubRepoInfo | null>()
  private static responseCache = new Map<string, RepoResponseCache>()
  private static openPrListCache = new Map<string, OpenPrListCache>()
  private static unresolvedThreadCache = new Map<string, UnresolvedThreadCacheEntry>()
  private static authToken: string | null = null
  private static authTokenChecked = false
  private static authTokenFetchedAt = 0

  static async isGhAvailable(): Promise<boolean> {
    if (this.ghAvailable !== null) return this.ghAvailable
    try {
      await execFileAsync('gh', ['--version'], { timeout: 5000 })
      this.ghAvailable = true
    } catch {
      this.ghAvailable = false
    }
    return this.ghAvailable
  }

  /**
   * Clone-tab suggestions: your repos (empty query) or `gh search repos` (non-empty).
   * Returns [] if `gh` is missing, not logged in, or the command errors.
   */
  static async listCloneRepoSuggestions(query: string): Promise<GithubCloneRepoSuggestion[]> {
    if (!(await this.isGhAvailable())) return []
    const trimmed = query.trim()
    try {
      if (trimmed.length === 0) {
        const { stdout } = await execFileAsync(
          'gh',
          ['repo', 'list', '-L', '25', '--json', 'nameWithOwner,url'],
          { timeout: 12_000 },
        )
        const rows = JSON.parse(stdout) as Array<{ nameWithOwner: string; url: string }>
        if (!Array.isArray(rows)) return []
        return rows.map((r) => ({ fullName: r.nameWithOwner, webUrl: r.url }))
      }
      const q = trimmed.slice(0, 200)
      const { stdout } = await execFileAsync(
        'gh',
        ['search', 'repos', q, '--limit', '20', '--json', 'fullName,url'],
        { timeout: 12_000 },
      )
      const rows = JSON.parse(stdout) as Array<{ fullName: string; url: string }>
      if (!Array.isArray(rows)) return []
      return rows.map((r) => ({ fullName: r.fullName, webUrl: r.url }))
    } catch {
      return []
    }
  }

  static async isGithubRepo(repoPath: string): Promise<boolean> {
    const cached = this.repoInfoCache.get(repoPath)
    if (cached !== undefined) return cached !== null
    const repoInfo = await this.getGithubRepoInfo(repoPath)
    return repoInfo !== null
  }

  private static async getGithubRepoInfo(repoPath: string): Promise<GithubRepoInfo | null> {
    const cached = this.repoInfoCache.get(repoPath)
    if (cached !== undefined) return cached
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: repoPath,
        timeout: 5000,
      })
      const repoInfo = this.parseGithubRemote(stdout)
      this.repoInfoCache.set(repoPath, repoInfo)
      return repoInfo
    } catch {
      this.repoInfoCache.set(repoPath, null)
      return null
    }
  }

  static async getPrStatuses(repoPath: string, branches: string[]): Promise<PrLookupResult> {
    if (!(await this.isGhAvailable())) {
      return { available: false, error: 'gh_not_installed', data: {} }
    }
    const repoInfo = await this.getGithubRepoInfo(repoPath)
    if (!repoInfo) {
      return { available: false, error: 'not_github_repo', data: {} }
    }
    const token = await this.getAuthToken()
    if (!token) {
      return { available: false, error: 'not_authenticated', data: {} }
    }

    const normalizedBranches = Array.from(
      new Set(
        branches
          .map((branch) => branch.trim())
          .filter(Boolean)
      )
    ).sort()

    if (normalizedBranches.length === 0) {
      return { available: true, data: {} }
    }

    const cacheKey = this.cacheKey(repoPath, normalizedBranches)
    const cached = this.responseCache.get(cacheKey)

    try {
      const result = await this.fetchRepoPrStatuses(repoInfo, normalizedBranches, token)
      this.setCachedResponse(cacheKey, result.data)
      return { available: true, data: this.cloneData(result.data) }
    } catch (err) {
      if (err instanceof GithubAuthError) {
        this.clearAuthTokenCache()
        return { available: false, error: 'not_authenticated', data: {} }
      }
      if (cached) {
        return { available: true, data: this.cloneData(cached.data) }
      }
      return { available: true, data: this.emptyResult(normalizedBranches) }
    }
  }

  static async listOpenPrs(repoPath: string): Promise<ListOpenPrsResult> {
    if (!(await this.isGhAvailable())) {
      return { available: false, error: 'gh_not_installed', data: [] }
    }
    const repoInfo = await this.getGithubRepoInfo(repoPath)
    if (!repoInfo) {
      return { available: false, error: 'not_github_repo', data: [] }
    }
    const token = await this.getAuthToken()
    if (!token) {
      return { available: false, error: 'not_authenticated', data: [] }
    }

    const cached = this.openPrListCache.get(repoPath)
    if (cached && Date.now() - cached.fetchedAt < this.OPEN_PR_LIST_CACHE_MS) {
      return { available: true, data: this.cloneOpenPrs(cached.data) }
    }

    try {
      const data = await this.fetchOpenPrList(repoInfo, token)
      this.openPrListCache.set(repoPath, {
        fetchedAt: Date.now(),
        data: this.cloneOpenPrs(data),
      })
      return { available: true, data: this.cloneOpenPrs(data) }
    } catch (err) {
      if (err instanceof GithubAuthError) {
        this.clearAuthTokenCache()
        return { available: false, error: 'not_authenticated', data: [] }
      }
      if (cached) {
        return { available: true, data: this.cloneOpenPrs(cached.data) }
      }
      return { available: true, data: [] }
    }
  }

  /**
   * Resolve a PR number to its head branch name and title.
   * Uses `gh pr view` which works for open, closed, and merged PRs.
   * When `repoSlug` is provided (e.g. "owner/repo"), `--repo` is passed to
   * `gh` so the PR is looked up in that repository instead of the one inferred
   * from `repoPath`.
   */
  static async resolvePr(
    repoPath: string,
    prNumber: number,
    repoSlug?: string,
  ): Promise<{ branch: string; title: string; number: number }> {
    if (!(await this.isGhAvailable())) {
      throw new Error('GitHub CLI (gh) is not installed')
    }
    try {
      const args = ['pr', 'view', String(prNumber), '--json', 'headRefName,title,number']
      if (repoSlug) args.push('--repo', repoSlug)
      const { stdout } = await execFileAsync('gh', args, { cwd: repoPath, timeout: 15_000 })
      const parsed = JSON.parse(stdout.trim()) as {
        headRefName?: string
        title?: string
        number?: number
      }
      if (!parsed.headRefName) {
        throw new Error(`PR #${prNumber} has no head branch`)
      }
      return {
        branch: parsed.headRefName,
        title: parsed.title ?? '',
        number: parsed.number ?? prNumber,
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Failed to parse PR #${prNumber} response`)
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Could not resolve')) {
        throw new Error(`PR #${prNumber} not found`)
      }
      throw err
    }
  }

  static async createPr(
    repoPath: string,
    headBranch: string,
    baseBranch: string,
  ): Promise<{ number: number; url: string }> {
    if (!(await this.isGhAvailable())) {
      throw new Error('GitHub CLI is not installed.')
    }
    const repoInfo = await this.getGithubRepoInfo(repoPath)
    if (!repoInfo) {
      throw new Error('Origin remote is not a GitHub repo.')
    }
    const token = await this.getAuthToken()
    if (!token) {
      throw new Error('GitHub CLI is not authenticated.')
    }

    // Match `git push origin` (see pushCurrentBranch): without `--repo`, `gh` may pick
    // another remote (e.g. upstream / fork parent) and compare branches that only exist on origin.
    const repoSlug = `${repoInfo.owner}/${repoInfo.name}`
    const prCreateLogContext = {
      worktreePath: repoPath,
      headBranch,
      baseBranch,
      repoSlug,
    }
    console.info('[github:create-pr] request', prCreateLogContext)

    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr',
          'create',
          '--fill',
          '--repo',
          repoSlug,
          '--head',
          headBranch,
          '--base',
          baseBranch,
        ],
        { cwd: repoPath, timeout: 30_000 },
      )
      const parsed = parsePrUrl(stdout.trim())

      try {
        const { stdout: viewStdout } = await execFileAsync(
          'gh',
          ['pr', 'view', '--repo', repoSlug, '--json', 'url,number'],
          { cwd: repoPath, timeout: 15_000 },
        )
        const view = JSON.parse(viewStdout.trim()) as { url?: string; number?: number }
        if (view.url && typeof view.number === 'number') {
          this.invalidatePrCaches()
          return { number: view.number, url: view.url }
        }
      } catch {
        // Fallback to parsing create output below.
      }

      if (parsed?.url) {
        this.invalidatePrCaches()
        return { number: parsed.number ?? 0, url: parsed.url }
      }

      throw new Error('Pull request created, but the URL could not be determined.')
    } catch (err) {
      const message = ghErrorMessage(err, 'Failed to create pull request.')
      console.warn('[github:create-pr] failed', { ...prCreateLogContext, message })
      throw new Error(message)
    }
  }

  static async reopenPr(
    repoPath: string,
    prNumber: number,
  ): Promise<{ number: number; url: string }> {
    if (!(await this.isGhAvailable())) {
      throw new Error('GitHub CLI is not installed.')
    }
    const repoInfo = await this.getGithubRepoInfo(repoPath)
    if (!repoInfo) {
      throw new Error('Origin remote is not a GitHub repo.')
    }
    const token = await this.getAuthToken()
    if (!token) {
      throw new Error('GitHub CLI is not authenticated.')
    }

    const repoSlug = `${repoInfo.owner}/${repoInfo.name}`

    try {
      await execFileAsync(
        'gh',
        ['pr', 'reopen', String(prNumber), '--repo', repoSlug],
        { cwd: repoPath, timeout: 20_000 },
      )
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'view', String(prNumber), '--repo', repoSlug, '--json', 'url,number'],
        { cwd: repoPath, timeout: 15_000 },
      )
      const parsed = JSON.parse(stdout.trim()) as { url?: string; number?: number }
      if (!parsed.url || typeof parsed.number !== 'number') {
        throw new Error('Pull request reopened, but the URL could not be determined.')
      }
      this.invalidatePrCaches()
      return { number: parsed.number, url: parsed.url }
    } catch (err) {
      throw new Error(ghErrorMessage(err, `Failed to reopen PR #${prNumber}.`))
    }
  }

  private static async getAuthToken(): Promise<string | null> {
    const now = Date.now()
    if (
      this.authTokenChecked &&
      now - this.authTokenFetchedAt < this.AUTH_TOKEN_REFRESH_MS
    ) {
      return this.authToken
    }

    this.authTokenChecked = true
    this.authTokenFetchedAt = now
    try {
      const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 })
      const token = stdout.trim()
      this.authToken = token || null
    } catch {
      this.authToken = null
    }
    return this.authToken
  }

  private static parseGithubRemote(remote: string): GithubRepoInfo | null {
    const parsed = parseGithubUrl(remote)
    return parsed ? { owner: parsed.owner, name: parsed.name } : null
  }

  private static cacheKey(repoPath: string, branches: string[]): string {
    return `${repoPath}::${branches.join('\u0000')}`
  }

  private static clearAuthTokenCache(): void {
    this.authToken = null
    this.authTokenChecked = false
    this.authTokenFetchedAt = 0
  }

  private static invalidatePrCaches(): void {
    this.responseCache.clear()
    this.openPrListCache.clear()
  }

  private static setCachedResponse(
    cacheKey: string,
    data: Record<string, PrInfo | null>
  ): void {
    this.responseCache.set(cacheKey, {
      data: this.cloneData(data),
    })
  }

  private static cloneData(data: Record<string, PrInfo | null>): Record<string, PrInfo | null> {
    const cloned: Record<string, PrInfo | null> = {}
    for (const [branch, pr] of Object.entries(data)) {
      cloned[branch] = pr ? { ...pr } : null
    }
    return cloned
  }

  private static cloneOpenPrs(data: OpenPrInfo[]): OpenPrInfo[] {
    return data.map((pr) => ({ ...pr }))
  }

  private static emptyResult(branches: string[]): Record<string, PrInfo | null> {
    const result: Record<string, PrInfo | null> = {}
    for (const branch of branches) result[branch] = null
    return result
  }

  private static async fetchRepoPrStatuses(
    repoInfo: GithubRepoInfo,
    branches: string[],
    token: string
  ): Promise<{ data: Record<string, PrInfo | null> }> {
    const { query, variables } = this.buildGraphqlQuery(repoInfo, branches)
    const payload = await this.fetchGraphqlJson<GraphqlResponse>(query, variables, token)

    const repository = payload.data?.repository
    if (!repository) {
      return { data: this.emptyResult(branches) }
    }

    const data: Record<string, PrInfo | null> = {}
    const unresolvedLookups: Promise<void>[] = []
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i]
      const openNode = repository[`b${i}Open`]?.nodes?.[0]
      const anyNode = repository[`b${i}Any`]?.nodes?.[0]
      const picked = openNode ?? anyNode
      const mapped = picked ? this.mapPullRequest(picked) : null
      data[branch] = mapped

      if (picked && mapped && mapped.state === 'open') {
        unresolvedLookups.push(
          this.attachUnresolvedReviewThreads(repoInfo, token, picked, mapped)
        )
      }
    }

    if (unresolvedLookups.length > 0) {
      await Promise.allSettled(unresolvedLookups)
    }

    return { data }
  }

  private static async fetchOpenPrList(
    repoInfo: GithubRepoInfo,
    token: string
  ): Promise<OpenPrInfo[]> {
    const { query, variables } = this.buildOpenPrListQuery(repoInfo, this.OPEN_PR_LIST_LIMIT)
    const payload = await this.fetchGraphqlJson<GraphqlOpenPrListResponse>(query, variables, token)
    const nodes = payload.data?.repository?.pullRequests?.nodes ?? []
    const data = nodes.map((node) => ({
      ...this.mapPullRequest(node),
      state: 'open' as const,
      headRefName: node.headRefName?.trim() || `pr-${node.number}`,
      authorLogin: node.author?.login || undefined,
    }))

    const unresolvedLookups: Promise<void>[] = []
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const mapped = data[i]
      if (node && mapped && mapped.state === 'open') {
        unresolvedLookups.push(
          this.attachUnresolvedReviewThreads(repoInfo, token, node, mapped)
        )
      }
    }

    if (unresolvedLookups.length > 0) {
      await Promise.allSettled(unresolvedLookups)
    }

    return data
  }

  private static buildGraphqlQuery(
    repoInfo: GithubRepoInfo,
    branches: string[]
  ): { query: string; variables: Record<string, string> } {
    const variableDefs = ['$owner: String!', '$name: String!']
    const fields: string[] = []
    const variables: Record<string, string> = {
      owner: repoInfo.owner,
      name: repoInfo.name,
    }

    for (let i = 0; i < branches.length; i++) {
      const varName = `b${i}`
      variableDefs.push(`$${varName}: String!`)
      variables[varName] = branches[i]
      fields.push(
        `b${i}Open: pullRequests(headRefName: $${varName}, states: OPEN, first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes { ...PrFields }
        }`
      )
      fields.push(
        `b${i}Any: pullRequests(headRefName: $${varName}, states: [OPEN, CLOSED, MERGED], first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes { ...PrFields }
        }`
      )
    }

    const query = `
      query PrStatuses(${variableDefs.join(', ')}) {
        repository(owner: $owner, name: $name) {
          ${fields.join('\n')}
        }
      }

      fragment PrFields on PullRequest {
        number
        state
        title
        url
        updatedAt
        reviewDecision
        mergeStateStatus
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
      }
    `

    return { query, variables }
  }

  private static buildOpenPrListQuery(
    repoInfo: GithubRepoInfo,
    first: number
  ): { query: string; variables: Record<string, string | number> } {
    const query = `
      query OpenPullRequests($owner: String!, $name: String!, $first: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequests(states: OPEN, first: $first, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              number
              state
              title
              url
              updatedAt
              headRefName
              reviewDecision
              mergeStateStatus
              author {
                login
              }
              commits(last: 1) {
                nodes {
                  commit {
                    statusCheckRollup {
                      state
                    }
                  }
                }
              }
            }
          }
        }
      }
    `

    return {
      query,
      variables: {
        owner: repoInfo.owner,
        name: repoInfo.name,
        first,
      },
    }
  }

  private static hasAuthError(errors: Array<{ message?: string }>): boolean {
    return errors.some(({ message }) => {
      const m = (message ?? '').toLowerCase()
      return (
        m.includes('bad credentials') ||
        m.includes('requires authentication') ||
        m.includes('resource not accessible') ||
        m.includes('could not resolve to a repository')
      )
    })
  }

  private static mapPullRequest(pr: GraphqlPullRequestNode): PrInfo {
    const rawState = pr.state.toLowerCase()
    const state: PrState =
      rawState === 'merged' || rawState === 'closed'
        ? rawState
        : 'open'
    const rollupState = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state
    const checkStatus = this.rollupStateToStatus(rollupState)
    const mergeStateStatus = pr.mergeStateStatus?.toUpperCase()
    const isOpen = state === 'open'
    const checksNotPassing = checkStatus === 'pending' || checkStatus === 'failing'
    const reviewDecision = pr.reviewDecision?.toUpperCase()

    return {
      number: pr.number,
      state,
      title: pr.title,
      url: pr.url,
      checkStatus,
      hasPendingComments: false,
      pendingCommentCount: 0,
      isBlockedByCi: isOpen && checksNotPassing && (
        mergeStateStatus ? mergeStateStatus === 'BLOCKED' : true
      ),
      isApproved: isOpen && reviewDecision === 'APPROVED',
      isChangesRequested: isOpen && reviewDecision === 'CHANGES_REQUESTED',
      updatedAt: pr.updatedAt,
    }
  }

  private static reviewThreadCacheKey(
    repoInfo: GithubRepoInfo,
    number: number,
    updatedAt: string
  ): string {
    return `${repoInfo.owner}/${repoInfo.name}#${number}@${updatedAt}`
  }

  private static updateReviewThreadCache(
    repoInfo: GithubRepoInfo,
    number: number,
    updatedAt: string,
    unresolvedCount: number
  ): void {
    const prefix = `${repoInfo.owner}/${repoInfo.name}#${number}@`
    for (const key of this.unresolvedThreadCache.keys()) {
      if (key.startsWith(prefix)) this.unresolvedThreadCache.delete(key)
    }
    this.unresolvedThreadCache.set(
      this.reviewThreadCacheKey(repoInfo, number, updatedAt),
      {
        count: unresolvedCount,
        fetchedAt: Date.now(),
      }
    )
  }

  private static async attachUnresolvedReviewThreads(
    repoInfo: GithubRepoInfo,
    token: string,
    prNode: GraphqlPullRequestNode,
    info: PrInfo
  ): Promise<void> {
    const key = this.reviewThreadCacheKey(repoInfo, prNode.number, prNode.updatedAt)
    const cached = this.unresolvedThreadCache.get(key)
    if (
      cached &&
      Date.now() - cached.fetchedAt < this.UNRESOLVED_THREAD_CACHE_TTL_MS
    ) {
      info.pendingCommentCount = cached.count
      info.hasPendingComments = cached.count > 0
      return
    }

    const unresolvedCount = await this.fetchUnresolvedReviewThreadCount(repoInfo, token, prNode.number)
    info.pendingCommentCount = unresolvedCount
    info.hasPendingComments = unresolvedCount > 0
    this.updateReviewThreadCache(repoInfo, prNode.number, prNode.updatedAt, unresolvedCount)
  }

  private static async fetchUnresolvedReviewThreadCount(
    repoInfo: GithubRepoInfo,
    token: string,
    number: number
  ): Promise<number> {
    let cursor: string | null = null
    let unresolvedCount = 0

    while (true) {
      const query = `
        query ReviewThreads($owner: String!, $name: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $cursor) {
                nodes {
                  isResolved
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `

      const payload: GraphqlReviewThreadsResponse = await this.fetchGraphqlJson<GraphqlReviewThreadsResponse>(
        query,
        {
          owner: repoInfo.owner,
          name: repoInfo.name,
          number,
          cursor,
        },
        token,
      )

      const threads = payload.data?.repository?.pullRequest?.reviewThreads
      if (!threads) return 0

      const nodes = Array.isArray(threads.nodes) ? threads.nodes : []
      unresolvedCount += nodes.filter((thread) => !thread.isResolved).length

      if (!threads.pageInfo?.hasNextPage) {
        return unresolvedCount
      }
      cursor = threads.pageInfo.endCursor ?? null
      if (!cursor) {
        return unresolvedCount
      }
    }
  }

  private static async fetchGraphqlJson<T extends { errors?: Array<{ message?: string }> }>(
    query: string,
    variables: Record<string, string | number | null>,
    token: string
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    let response: Response
    try {
      response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'constellagent-desktop',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (response.status === 401 || response.status === 403) {
      throw new GithubAuthError(`GitHub API auth failed (${response.status})`)
    }
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status})`)
    }

    const payload = await response.json() as T
    if (payload.errors && payload.errors.length > 0) {
      if (this.hasAuthError(payload.errors)) {
        throw new GithubAuthError(payload.errors[0]?.message ?? 'GitHub auth error')
      }
      throw new Error(payload.errors[0]?.message ?? 'GraphQL query failed')
    }

    return payload
  }

  static async fetchPrReviewComments(
    repoPath: string,
    prNumber: number,
  ): Promise<PrReviewComment[]> {
    if (!(await this.isGhAvailable())) return []
    const repoInfo = await this.getGithubRepoInfo(repoPath)
    if (!repoInfo) return []
    const token = await this.getAuthToken()
    if (!token) return []

    const query = `
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                path
                line
                startLine
                diffSide
                comments(first: 50) {
                  nodes {
                    id
                    body
                    author { login }
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    `
    const data = await this.fetchGraphqlJson<GraphqlPrReviewCommentsResponse>(
      query,
      { owner: repoInfo.owner, name: repoInfo.name, number: prNumber },
      token,
    )
    const threads = data.data?.repository?.pullRequest?.reviewThreads?.nodes
    if (!threads) return []
    return threads.flatMap((thread) =>
      thread.comments.nodes.map((comment) => ({
        id: comment.id,
        threadId: thread.id,
        filePath: thread.path,
        line: thread.line,
        startLine: thread.startLine,
        diffSide: (thread.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT') as 'LEFT' | 'RIGHT',
        body: comment.body,
        author: comment.author?.login ?? 'unknown',
        createdAt: comment.createdAt,
        resolved: thread.isResolved,
      })),
    )
  }

  private static rollupStateToStatus(rollupState: string | undefined): CheckStatus {
    const state = rollupState?.toUpperCase()
    if (!state) return 'none'
    if (state === 'FAILURE' || state === 'ERROR') return 'failing'
    if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
    if (state === 'SUCCESS') return 'passing'
    return 'none'
  }
}
