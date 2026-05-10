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
export function unwrapComposioTriggerEnvelope(raw: unknown): unknown {
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

// --- Filtered summary for automation agents (no secrets, bounded size) ---

const BRIEF_STRING_KEYS = new Set([
  'subject',
  'sender',
  'from',
  'to',
  'message_text',
  'body',
  'snippet',
  'preview',
  'summary',
  'title',
  'html_url',
  'url',
  'message_id',
  'thread_id',
  'action',
  'state',
  'author_login',
  'repository_url',
  'repository',
  'head_ref',
  'head_branch',
  'number',
  'name',
  'description',
  'draft',
  'created_at',
  'updated_at',
  'merged',
  'login',
  'ref',
  'full_name',
  'event',
  'trigger_slug',
  'label',
])

function shouldRedactBriefKey(k: string): boolean {
  return /secret|password|authorization|api_?key|access_token|refresh_token|credential|cookie|bearer/i.test(k)
}

function truncateBriefValue(s: string, maxLen: number): string {
  const t = s.trim()
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen)}…`
}

function formatMergedPrBrief(extracted: ExtractedGithubPrMerge): string {
  const pr = extracted.pullRequest
  const lines = [
    '### Composio event (GitHub: PR merged)',
    `- **Repository:** ${extracted.owner}/${extracted.repo}`,
    `- **PR #${pr.number}:** ${pr.title ?? '(no title)'}`,
    `- **Head branch:** ${extracted.headBranch}`,
  ]
  if (pr.html_url) lines.push(`- **URL:** ${pr.html_url}`)
  return lines.join('\n')
}

function formatNestedGithubPrBrief(inner: unknown): string | null {
  const body = asRecord(inner)
  if (!body) return null
  const pr = pickPullRequest(body)
  if (!pr) return null
  const repo = repoFromBody(body, pr)
  if (!repo) return null
  const numRaw = typeof pr.number === 'number' ? pr.number : Number(pr.number)
  if (!Number.isFinite(numRaw)) return null
  const num = Math.floor(numRaw)
  const head = asRecord(pr.head)
  const headBranch =
    typeof head?.ref === 'string'
      ? head.ref
      : typeof pr.head_ref === 'string'
        ? pr.head_ref
        : ''
  if (!headBranch) return null
  const title = typeof pr.title === 'string' ? pr.title : ''
  const html = typeof pr.html_url === 'string' ? pr.html_url : ''
  const state = typeof pr.state === 'string' ? pr.state : ''
  const user = asRecord(pr.user)
  const login = typeof user?.login === 'string' ? user.login : ''
  const merged = mergedFlag(pr)

  const heading = merged
    ? '### Composio event (GitHub: PR merged)'
    : '### Composio event (GitHub: pull request)'
  const lines = [
    heading,
    `- **Repository:** ${repo.owner}/${repo.name}`,
    `- **PR #${num}:** ${title || '(no title)'}`,
    `- **State:** ${state || (merged ? 'merged' : 'unknown')}`,
    `- **Author:** ${login || 'unknown'}`,
    `- **Head branch:** ${headBranch}`,
  ]
  if (html) lines.push(`- **URL:** ${html}`)
  return lines.join('\n')
}

/** Flat PR-shaped `data` without nested `pull_request` (open, sync, etc.). */
function formatFlatGithubPrBrief(inner: unknown): string | null {
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

  const title = typeof body.title === 'string' ? body.title : ''
  const state = typeof body.state === 'string' ? body.state : ''
  const merged = flatPullRequestMergedSignal(body)
  const heading = merged
    ? '### Composio event (GitHub: PR merged)'
    : '### Composio event (GitHub: pull request)'
  const lines = [
    heading,
    `- **Repository:** ${parsedUrl.owner}/${parsedUrl.repo}`,
    `- **PR #${num}:** ${title || '(no title)'}`,
    `- **State:** ${state || (merged ? 'merged' : 'unknown')}`,
    `- **Head branch:** ${headBranch}`,
  ]
  if (typeof body.html_url === 'string') lines.push(`- **URL:** ${body.html_url}`)
  return lines.join('\n')
}

function collectBriefKeyLines(value: unknown, out: Map<string, string>, depth: number): void {
  if (depth > 10) return
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) collectBriefKeyLines(item, out, depth + 1)
    return
  }
  const rec = asRecord(value)
  if (!rec) return
  for (const [k, v] of Object.entries(rec)) {
    if (shouldRedactBriefKey(k)) continue
    const kl = k.toLowerCase()
    if (typeof v === 'string') {
      if (!BRIEF_STRING_KEYS.has(kl)) continue
      const cap = kl === 'body' || kl === 'message_text' || kl === 'snippet' ? 2000 : 600
      const slice = truncateBriefValue(v, cap)
      const label = k.replace(/_/g, ' ')
      if (!out.has(label)) out.set(label, slice)
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      if (!BRIEF_STRING_KEYS.has(kl)) continue
      const label = k.replace(/_/g, ' ')
      if (!out.has(label)) out.set(label, String(v))
    } else if (v !== null && typeof v === 'object') {
      collectBriefKeyLines(v, out, depth + 1)
    }
  }
}

/**
 * Human-readable, bounded summary of a Composio webhook payload for agent context.
 * Omits tokens/secrets and caps long text; prefers GitHub PR and email-shaped fields.
 */
export function summarizeComposioPayloadForAgent(payload: unknown): string {
  if (payload === undefined || payload === null) return ''

  const envelopeMeta: string[] = []
  const root = asRecord(payload)
  if (typeof root?.type === 'string' && root.type === 'composio.trigger.message') {
    envelopeMeta.push('_Envelope:_ `composio.trigger.message`')
    const md = asRecord(root.metadata)
    if (md && typeof md.trigger_slug === 'string') {
      envelopeMeta.push(`_Trigger slug:_ ${md.trigger_slug}`)
    }
  }

  const inner = unwrapComposioTriggerEnvelope(payload)

  const nestedGh = formatNestedGithubPrBrief(inner)
  if (nestedGh) {
    const head = envelopeMeta.length ? `${envelopeMeta.join('\n')}\n\n` : ''
    return `${head}${nestedGh}`.slice(0, 8000)
  }

  const merged = tryExtractGithubPrMergeFromComposioBody(payload)
  if (merged) {
    const head = envelopeMeta.length ? `${envelopeMeta.join('\n')}\n\n` : ''
    return `${head}${formatMergedPrBrief(merged)}`.slice(0, 8000)
  }

  const flatGh = formatFlatGithubPrBrief(inner)
  if (flatGh) {
    const head = envelopeMeta.length ? `${envelopeMeta.join('\n')}\n\n` : ''
    return `${head}${flatGh}`.slice(0, 8000)
  }

  const kv = new Map<string, string>()
  collectBriefKeyLines(inner, kv, 0)
  if (kv.size > 0) {
    const lines = ['### Composio event (extracted fields)']
    for (const [label, val] of kv) {
      const oneLine = val.includes('\n') ? val.split('\n').slice(0, 12).join('\n') : val
      lines.push(`- **${label}:** ${oneLine}`)
    }
    const head = envelopeMeta.length ? `${envelopeMeta.join('\n')}\n\n` : ''
    return `${head}${lines.join('\n')}`.slice(0, 8000)
  }

  const head = envelopeMeta.length ? `${envelopeMeta.join('\n')}\n\n` : ''
  return `${head}### Composio event\n_Automation trigger fired; payload had no recognized GitHub PR or labeled fields. Use your instructions and tools as needed._`.slice(
    0,
    2000,
  )
}
