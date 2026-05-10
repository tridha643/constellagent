/**
 * Composio webhook / forward payload normalization
 * -----------------------------------------------
 * Composio may forward toolkit-specific JSON. Common patterns observed:
 * - V3 subscription / CLI: `{ type: "composio.trigger.message", data: { … } }` — unwrap `data` first.
 * - Wrapped: `{ data: { ... }, type?: string }` or `{ payload: ... }`
 * - GitHub-shaped: `{ pull_request: { ... }, repository?: { full_name } }` (similar to GH webhooks)
 * - Flat PR fields at top level of `data` (no nested `pull_request`): `url`/`html_url`, `merged`, `head_ref`, etc.
 * - Forwarded HTTP may repeat the inner event as the whole body.
 *
 * Verification: use a shared secret (header `x-constellagent-webhook-secret` or `?secret=`).
 * Composio-hosted callbacks may support custom headers when configuring the forward URL —
 * confirm in your Composio project / trigger settings.
 */

import type { PrInfo } from '../shared/github-types'
import type { GithubRepoInfo } from '../shared/github-url'

export interface ExtractedGithubPrMerge {
  owner: string
  repo: string
  headBranch: string
  pullRequest: {
    number: number
    title?: string
    html_url?: string
    merged_at?: string
    updated_at?: string
    id?: number
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Composio V3 delivers trigger payloads inside this envelope when using webhook_subscriptions. */
function unwrapComposioTriggerEnvelope(raw: unknown): unknown {
  const body = asRecord(raw)
  if (!body) return raw
  if (body.type === 'composio.trigger.message' && body.data !== undefined) {
    return body.data
  }
  return raw
}

function parseGithubPullRequestUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i)
  if (!m) return null
  const num = Number(m[3])
  if (!Number.isFinite(num)) return null
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/i, '').trim(), number: Math.floor(num) }
}

function flatPullRequestMergedSignal(data: Record<string, unknown>): boolean {
  if (data.merged === true) return true
  if (typeof data.merged_at === 'string' && data.merged_at.trim().length > 0) return true
  if (data.action === 'merged') return true
  if (data.action === 'closed' && data.merged === true) return true
  return false
}

/**
 * Some Composio toolkits flatten PR fields on `data` without a nested `pull_request` object.
 * We require a GitHub PR URL and merged signal, plus a head branch name.
 */
function tryExtractFromComposioFlatPrMerge(inner: unknown): ExtractedGithubPrMerge | null {
  const body = asRecord(inner)
  if (!body) return null
  if (pickPullRequest(body)) return null

  const urlRaw =
    typeof body.html_url === 'string'
      ? body.html_url
      : typeof body.url === 'string'
        ? body.url
        : undefined
  if (!urlRaw?.trim()) return null

  const parsedUrl = parseGithubPullRequestUrl(urlRaw)
  if (!parsedUrl) return null
  if (!flatPullRequestMergedSignal(body)) return null

  const head = asRecord(body.head)
  const headBranch =
    typeof head?.ref === 'string'
      ? head.ref
      : typeof body.head_ref === 'string'
        ? body.head_ref
        : typeof body.head_branch === 'string'
          ? body.head_branch
          : typeof body.headBranch === 'string'
            ? body.headBranch
            : ''
  if (!headBranch) return null

  const numRaw = typeof body.number === 'number' ? body.number : Number(body.number)
  const num = Number.isFinite(numRaw) ? Math.floor(numRaw) : parsedUrl.number
  if (Number.isFinite(numRaw) && Math.floor(numRaw) !== parsedUrl.number) return null

  return {
    owner: parsedUrl.owner,
    repo: parsedUrl.repo,
    headBranch,
    pullRequest: {
      number: num,
      title: typeof body.title === 'string' ? body.title : undefined,
      html_url: typeof body.html_url === 'string' ? body.html_url : urlRaw,
      merged_at: typeof body.merged_at === 'string' ? body.merged_at : undefined,
      updated_at: typeof body.updated_at === 'string' ? body.updated_at : undefined,
      id: typeof body.id === 'number' ? body.id : undefined,
    },
  }
}

function pickPullRequest(body: Record<string, unknown>): Record<string, unknown> | null {
  const direct = asRecord(body.pull_request)
  if (direct) return direct
  const data = asRecord(body.data)
  if (data) {
    const inner = asRecord(data.pull_request)
    if (inner) return inner
  }
  const payload = asRecord(body.payload)
  if (payload) {
    const inner = asRecord(payload.pull_request)
    if (inner) return inner
  }
  return null
}

function parseRepoFullName(full: string): GithubRepoInfo | null {
  const [o, r] = full.split('/')
  if (!o?.trim() || !r?.trim()) return null
  return { owner: o.trim(), name: r.replace(/\.git$/i, '').trim() }
}

function repoFromBody(body: Record<string, unknown>, pr: Record<string, unknown>): GithubRepoInfo | null {
  const repo =
    asRecord(asRecord(pr.head)?.repo) ??
    asRecord(asRecord(pr.base)?.repo) ??
    asRecord(body.repository)
  const full = typeof repo?.full_name === 'string' ? repo.full_name : undefined
  if (full) {
    const p = parseRepoFullName(full)
    if (p) return p
  }
  const ownerObj = asRecord(repo?.owner)
  const login = typeof ownerObj?.login === 'string' ? ownerObj.login : undefined
  const name = typeof repo?.name === 'string' ? repo.name : undefined
  if (login && name) return { owner: login, name }

  return null
}

function mergedFlag(pr: Record<string, unknown>): boolean {
  if (pr.merged === true) return true
  if (typeof pr.merged_at === 'string' && pr.merged_at.length > 0) return true
  return false
}

export function tryExtractGithubPrMergeFromComposioBody(raw: unknown): ExtractedGithubPrMerge | null {
  const inner = unwrapComposioTriggerEnvelope(raw)
  const flat = tryExtractFromComposioFlatPrMerge(inner)
  if (flat) return flat

  const body = asRecord(inner)
  if (!body) return null
  const pr = pickPullRequest(body)
  if (!pr) return null
  if (!mergedFlag(pr)) return null

  const repo = repoFromBody(body, pr)
  if (!repo) return null

  const num = typeof pr.number === 'number' ? pr.number : Number(pr.number)
  if (!Number.isFinite(num)) return null

  const head = asRecord(pr.head)
  const headBranch =
    typeof head?.ref === 'string'
      ? head.ref
      : typeof pr.head_ref === 'string'
        ? pr.head_ref
        : ''
  if (!headBranch) return null

  return {
    owner: repo.owner,
    repo: repo.name,
    headBranch,
    pullRequest: {
      number: num,
      title: typeof pr.title === 'string' ? pr.title : undefined,
      html_url: typeof pr.html_url === 'string' ? pr.html_url : undefined,
      merged_at: typeof pr.merged_at === 'string' ? pr.merged_at : undefined,
      updated_at: typeof pr.updated_at === 'string' ? pr.updated_at : undefined,
      id: typeof pr.id === 'number' ? pr.id : undefined,
    },
  }
}

export function prInfoFromExtracted(extracted: ExtractedGithubPrMerge): PrInfo {
  return {
    number: extracted.pullRequest.number,
    state: 'merged',
    title: extracted.pullRequest.title ?? `PR #${extracted.pullRequest.number}`,
    url: extracted.pullRequest.html_url ?? '',
    checkStatus: 'none',
    hasPendingComments: false,
    pendingCommentCount: 0,
    isBlockedByCi: false,
    isApproved: false,
    isChangesRequested: false,
    updatedAt:
      extracted.pullRequest.merged_at ?? extracted.pullRequest.updated_at ?? new Date().toISOString(),
  }
}
