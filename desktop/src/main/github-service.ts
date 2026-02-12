import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PrInfo, PrLookupResult, CheckStatus, PrState } from '../shared/github-types'

const execFileAsync = promisify(execFile)

interface GithubRepoInfo {
  owner: string
  name: string
}

interface GraphqlPullRequestNode {
  number: number
  state: string
  title: string
  url: string
  updatedAt: string
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

interface RepoResponseCache {
  etag?: string
  data: Record<string, PrInfo | null>
}

class GithubAuthError extends Error {}

export class GithubService {
  private static MAX_GRAPHQL_GET_URL_LENGTH = 7000
  private static AUTH_TOKEN_REFRESH_MS = 60_000
  private static ghAvailable: boolean | null = null
  private static repoInfoCache = new Map<string, GithubRepoInfo | null>()
  private static responseCache = new Map<string, RepoResponseCache>()
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
      const result = await this.fetchRepoPrStatuses(repoInfo, normalizedBranches, token, cached?.etag)

      if (result.notModified) {
        if (cached) {
          return { available: true, data: this.cloneData(cached.data) }
        }
        // 304 without local cache should be impossible, but recover safely.
        const fallback = await this.fetchRepoPrStatuses(repoInfo, normalizedBranches, token)
        this.setCachedResponse(cacheKey, fallback.etag, fallback.data)
        return { available: true, data: this.cloneData(fallback.data) }
      }

      this.setCachedResponse(cacheKey, result.etag, result.data)
      return { available: true, data: this.cloneData(result.data) }
    } catch (err) {
      if (err instanceof GithubAuthError) {
        this.authToken = null
        this.authTokenChecked = false
        this.authTokenFetchedAt = 0
        return { available: false, error: 'not_authenticated', data: {} }
      }
      if (cached) {
        return { available: true, data: this.cloneData(cached.data) }
      }
      return { available: true, data: this.emptyResult(normalizedBranches) }
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
    const trimmed = remote.trim()
    if (!trimmed) return null

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('ssh://')) {
      try {
        const parsed = new URL(trimmed)
        if (parsed.hostname.toLowerCase() !== 'github.com') return null
        const parts = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
        if (parts.length < 2) return null
        const owner = parts[0]
        const name = parts[1].replace(/\.git$/i, '')
        if (!owner || !name) return null
        return { owner, name }
      } catch {
        return null
      }
    }

    const sshMatch = trimmed.match(/^[^@]+@github\.com:([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/i)
    if (sshMatch?.[1] && sshMatch?.[2]) {
      return { owner: sshMatch[1], name: sshMatch[2] }
    }

    const plainMatch = trimmed.match(/^github\.com[:/]([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/i)
    if (plainMatch?.[1] && plainMatch?.[2]) {
      return { owner: plainMatch[1], name: plainMatch[2] }
    }

    return null
  }

  private static cacheKey(repoPath: string, branches: string[]): string {
    return `${repoPath}::${branches.join('\u0000')}`
  }

  private static setCachedResponse(
    cacheKey: string,
    etag: string | undefined,
    data: Record<string, PrInfo | null>
  ): void {
    this.responseCache.set(cacheKey, {
      etag,
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

  private static emptyResult(branches: string[]): Record<string, PrInfo | null> {
    const result: Record<string, PrInfo | null> = {}
    for (const branch of branches) result[branch] = null
    return result
  }

  private static async fetchRepoPrStatuses(
    repoInfo: GithubRepoInfo,
    branches: string[],
    token: string,
    ifNoneMatch?: string
  ): Promise<{ data: Record<string, PrInfo | null>; etag?: string; notModified?: boolean }> {
    const { query, variables } = this.buildGraphqlQuery(repoInfo, branches)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'constellagent-desktop',
    }
    if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch

    const getUrl = this.buildGraphqlGetUrl(query, variables)
    const useGet = getUrl.toString().length <= this.MAX_GRAPHQL_GET_URL_LENGTH

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    let response: Response
    try {
      if (useGet) {
        response = await fetch(getUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        })
      } else {
        response = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        })
      }
    } finally {
      clearTimeout(timeout)
    }

    if (response.status === 304) {
      return { data: this.emptyResult(branches), etag: ifNoneMatch, notModified: true }
    }

    if (response.status === 401 || response.status === 403) {
      throw new GithubAuthError(`GitHub API auth failed (${response.status})`)
    }
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status})`)
    }

    const etag = response.headers.get('etag') ?? undefined
    const payload = await response.json() as GraphqlResponse

    if (payload.errors && payload.errors.length > 0) {
      if (this.hasAuthError(payload.errors)) {
        throw new GithubAuthError(payload.errors[0]?.message ?? 'GitHub auth error')
      }
      throw new Error(payload.errors[0]?.message ?? 'GraphQL query failed')
    }

    const repository = payload.data?.repository
    if (!repository) {
      return { data: this.emptyResult(branches), etag }
    }

    const data: Record<string, PrInfo | null> = {}
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i]
      const openNode = repository[`b${i}Open`]?.nodes?.[0]
      const anyNode = repository[`b${i}Any`]?.nodes?.[0]
      const picked = openNode ?? anyNode
      data[branch] = picked ? this.mapPullRequest(picked) : null
    }

    return { data, etag }
  }

  private static buildGraphqlGetUrl(query: string, variables: Record<string, string>): URL {
    const url = new URL('https://api.github.com/graphql')
    url.searchParams.set('query', query)
    url.searchParams.set('variables', JSON.stringify(variables))
    return url
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

    return {
      number: pr.number,
      state,
      title: pr.title,
      url: pr.url,
      checkStatus: this.rollupStateToStatus(rollupState),
      updatedAt: pr.updatedAt,
    }
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
