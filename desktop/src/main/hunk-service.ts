import { execFile, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { realpathSync } from 'fs'
import type { HunkComment, HunkSessionInfo, HunkSessionContext, HunkVersionInfo } from '../shared/hunk-types'

export type { HunkComment, HunkSessionInfo, HunkSessionContext, HunkVersionInfo }

const execFileAsync = promisify(execFile)

// ── Daemon connection config ──

const DAEMON_HOST = process.env.HUNK_MCP_HOST ?? '127.0.0.1'
const DAEMON_PORT = Number(process.env.HUNK_MCP_PORT) || 47657
const DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`
const SESSION_API = '/session-api'

// ── State ──

const backgroundProcesses = new Map<string, ChildProcess>()
const ownSessionIds = new Map<string, string>()

interface CachedSession { id: string; ts: number }
const sessionCache = new Map<string, CachedSession>()
const SESSION_CACHE_TTL = 30_000

/** Serializes `startSession` per normalized repo so parallel calls cannot double-spawn. */
const startSessionChains = new Map<string, Promise<void>>()

/** Serializes global `hunkdiff` install so parallel callers do not run `npm i -g` multiple times. */
let ensureCliInstallChain: Promise<void> = Promise.resolve()

let daemonPid: number | undefined

function shouldSkipHunkAutoInstall(): boolean {
  if (process.env.CI_TEST === '1' || process.env.CI_TEST === 'true') return true
  if (process.env.CONSTELLAGENT_SKIP_HUNK_AUTO_INSTALL === '1') return true
  return false
}

async function getInstalledVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('hunk', ['--version'], { timeout: 5000 })
    const match = stdout.trim().match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// ── Path normalization ──

function resolveRepo(worktreePath: string): string {
  try {
    return realpathSync(worktreePath)
  } catch {
    return worktreePath
  }
}

function normalizeForCompare(p: string): string {
  return resolveRepo(p).replace(/\/+$/, '')
}

// ── Daemon HTTP client ──

async function daemonRequest<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${DAEMON_URL}${SESSION_API}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `Hunk daemon error: ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function isDaemonHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(500) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Ensures `hunk` is on PATH by running `npm i -g hunkdiff` when missing.
 * Skipped in CI/e2e and when CONSTELLAGENT_SKIP_HUNK_AUTO_INSTALL=1.
 */
async function ensureCliInstalled(): Promise<void> {
  if (shouldSkipHunkAutoInstall()) return
  if (await getInstalledVersion()) return
  ensureCliInstallChain = ensureCliInstallChain.then(async () => {
    if (await getInstalledVersion()) return
    await execFileAsync('npm', ['i', '-g', 'hunkdiff'], { timeout: 60_000 })
  })
  return ensureCliInstallChain
}

async function ensureDaemon(): Promise<void> {
  await ensureCliInstalled()
  if (await isDaemonHealthy()) return

  const child = spawn('hunk', ['mcp', 'serve'], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  daemonPid = child.pid

  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
    if (await isDaemonHealthy()) return
  }
  throw new Error('Hunk daemon failed to start within 3s')
}

// ── Session resolution (client-side, normalized paths) ──

interface DaemonSession {
  sessionId: string
  pid: number
  cwd: string
  repoRoot: string
  inputKind?: string
  title?: string
  sourceLabel?: string
  updatedAt?: string
}

interface DaemonListResponse { sessions: DaemonSession[] }

async function resolveSessionId(repo: string): Promise<string | null> {
  const norm = normalizeForCompare(repo)

  const cached = sessionCache.get(norm)
  if (cached && Date.now() - cached.ts < SESSION_CACHE_TTL) return cached.id

  try {
    await ensureDaemon()
    const { sessions } = await daemonRequest<DaemonListResponse>({ action: 'list' })

    const matches = sessions.filter(
      (s) => normalizeForCompare(s.repoRoot) === norm,
    )
    if (matches.length === 0) return null

    const ownId = ownSessionIds.get(norm)
    const best = matches.find((s) => s.sessionId === ownId) ?? matches[0]

    sessionCache.set(norm, { id: best.sessionId, ts: Date.now() })
    return best.sessionId
  } catch (e) {
    console.error('[HunkService] resolveSessionId failed:', e)
    return null
  }
}

function invalidateCache(repo: string): void {
  sessionCache.delete(normalizeForCompare(repo))
}

// ── Daemon response shapes ──

interface DaemonContextResponse {
  context: {
    sessionId?: string
    selectedFile?: { path?: string }
    selectedHunk?: { index?: number }
    [key: string]: unknown
  }
}

interface DaemonCommentListResponse {
  comments: Array<{
    commentId: string
    filePath: string
    hunkIndex: number
    side: 'new' | 'old'
    line: number
    summary: string
    rationale?: string
    author?: string
    createdAt?: string
  }>
}

// ── Mappers ──

function mapSession(raw: DaemonSession): HunkSessionInfo {
  return {
    id: raw.sessionId,
    path: raw.cwd,
    repo: raw.repoRoot,
    source: raw.sourceLabel,
  }
}

function mapComment(raw: DaemonCommentListResponse['comments'][number]): HunkComment {
  return {
    id: raw.commentId,
    file: raw.filePath,
    newLine: raw.side === 'new' ? raw.line : undefined,
    oldLine: raw.side === 'old' ? raw.line : undefined,
    summary: raw.summary,
    rationale: raw.rationale,
    author: raw.author,
  }
}

// ── Version checking ──

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// ── Public API ──

export const HunkService = {
  async isAvailable(): Promise<boolean> {
    try {
      await ensureDaemon()
      return true
    } catch {
      return false
    }
  },

  resetAvailabilityCache(): void {
    // No separate cache needed — ensureDaemon is idempotent
  },

  async checkForUpdate(): Promise<HunkVersionInfo> {
    const installed = await getInstalledVersion()
    if (!installed) return { installed: null, latest: null, updateAvailable: false }
    try {
      const res = await fetch('https://registry.npmjs.org/-/package/hunkdiff/dist-tags', {
        signal: AbortSignal.timeout(5000),
      })
      const tags = await res.json() as { latest?: string }
      const latest = tags.latest ?? null
      const updateAvailable = !!latest && compareSemver(installed, latest) < 0
      return { installed, latest, updateAvailable }
    } catch {
      return { installed, latest: null, updateAvailable: false }
    }
  },

  async performUpdate(): Promise<void> {
    await execFileAsync('npm', ['i', '-g', 'hunkdiff'], { timeout: 60_000 })
  },

  async startSession(worktreePath: string): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const norm = normalizeForCompare(repo)
    const prev = startSessionChains.get(norm) ?? Promise.resolve()

    const run = async (): Promise<void> => {
      if (backgroundProcesses.has(repo)) return

      await ensureDaemon()

      const existingId = await resolveSessionId(repo)
      if (existingId) return

      const child = spawn('hunk', ['diff', '--watch', 'HEAD'], {
        cwd: repo,
        stdio: 'ignore',
        detached: true,
      })
      child.unref()
      backgroundProcesses.set(repo, child)

      child.on('exit', () => {
        backgroundProcesses.delete(repo)
        invalidateCache(repo)
        ownSessionIds.delete(normalizeForCompare(repo))
      })

      await new Promise((resolve) => setTimeout(resolve, 800))

      const newId = await resolveSessionId(repo)
      if (newId) ownSessionIds.set(normalizeForCompare(repo), newId)
    }

    const next = prev.catch(() => {}).then(run)
    startSessionChains.set(norm, next)
    await next
  },

  async stopSession(worktreePath: string): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const child = backgroundProcesses.get(repo)
    if (child) {
      child.kill('SIGTERM')
      backgroundProcesses.delete(repo)
    }
    invalidateCache(repo)
    ownSessionIds.delete(normalizeForCompare(repo))
  },

  async findSessionForRepo(worktreePath: string): Promise<HunkSessionInfo | null> {
    try {
      const repo = resolveRepo(worktreePath)
      await ensureDaemon()
      const { sessions } = await daemonRequest<DaemonListResponse>({ action: 'list' })
      const norm = normalizeForCompare(repo)
      const match = sessions.find((s) => normalizeForCompare(s.repoRoot) === norm)
      if (!match) return null
      sessionCache.set(norm, { id: match.sessionId, ts: Date.now() })
      return mapSession(match)
    } catch {
      return null
    }
  },

  async listSessions(): Promise<HunkSessionInfo[]> {
    try {
      await ensureDaemon()
      const { sessions } = await daemonRequest<DaemonListResponse>({ action: 'list' })
      return sessions.map(mapSession)
    } catch {
      return []
    }
  },

  async getContext(worktreePath: string): Promise<HunkSessionContext | null> {
    try {
      const repo = resolveRepo(worktreePath)
      const sessionId = await resolveSessionId(repo)
      if (!sessionId) return null
      await ensureDaemon()
      const { context } = await daemonRequest<DaemonContextResponse>({
        action: 'context',
        selector: { sessionId },
      })
      return {
        file: context.selectedFile?.path,
        hunk: context.selectedHunk?.index,
      }
    } catch {
      return null
    }
  },

  async addComment(
    worktreePath: string,
    file: string,
    newLine: number,
    summary: string,
    opts?: { rationale?: string; author?: string; focus?: boolean; oldLine?: number },
  ): Promise<void> {
    const repo = resolveRepo(worktreePath)
    let sessionId = await resolveSessionId(repo)
    if (!sessionId) {
      await this.startSession(worktreePath)
      sessionId = await resolveSessionId(repo)
    }
    if (!sessionId) throw new Error(`No hunk session for ${repo}`)

    await ensureDaemon()
    const body: Record<string, unknown> = {
      action: 'comment-add',
      selector: { sessionId },
      filePath: file,
      summary,
    }
    if (opts?.oldLine != null) {
      body.side = 'old'
      body.line = opts.oldLine
    } else {
      body.side = 'new'
      body.line = newLine
    }
    if (opts?.rationale) body.rationale = opts.rationale
    if (opts?.author) body.author = opts.author
    if (opts?.focus) body.reveal = true

    await daemonRequest(body)
  },

  async listComments(worktreePath: string, file?: string): Promise<HunkComment[]> {
    try {
      const repo = resolveRepo(worktreePath)
      const sessionId = await resolveSessionId(repo)
      if (!sessionId) return []
      await ensureDaemon()
      const body: Record<string, unknown> = {
        action: 'comment-list',
        selector: { sessionId },
      }
      if (file) body.filePath = file
      const res = await daemonRequest<DaemonCommentListResponse>(body)
      return res.comments.map(mapComment)
    } catch {
      return []
    }
  },

  async removeComment(worktreePath: string, commentId: string): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const sessionId = await resolveSessionId(repo)
    if (!sessionId) throw new Error(`No hunk session for ${repo}`)
    await ensureDaemon()
    await daemonRequest({
      action: 'comment-rm',
      selector: { sessionId },
      commentId,
    })
  },

  async clearComments(worktreePath: string, file?: string): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const sessionId = await resolveSessionId(repo)
    if (!sessionId) throw new Error(`No hunk session for ${repo}`)
    await ensureDaemon()
    const body: Record<string, unknown> = {
      action: 'comment-clear',
      selector: { sessionId },
    }
    if (file) body.filePath = file
    await daemonRequest(body)
  },

  async navigate(
    worktreePath: string,
    file: string,
    target: { hunk?: number; newLine?: number; oldLine?: number },
  ): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const sessionId = await resolveSessionId(repo)
    if (!sessionId) throw new Error(`No hunk session for ${repo}`)
    await ensureDaemon()
    const body: Record<string, unknown> = {
      action: 'navigate',
      selector: { sessionId },
      filePath: file,
    }
    if (target.hunk != null) body.hunkNumber = target.hunk + 1
    else if (target.newLine != null) {
      body.side = 'new'
      body.line = target.newLine
    } else if (target.oldLine != null) {
      body.side = 'old'
      body.line = target.oldLine
    }
    await daemonRequest(body)
  },

  async reload(worktreePath: string, command: string[]): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const sessionId = await resolveSessionId(repo)
    if (!sessionId) throw new Error(`No hunk session for ${repo}`)
    await ensureDaemon()
    await daemonRequest({
      action: 'reload',
      selector: { sessionId },
      command,
    })
  },

  cleanupAll(): void {
    for (const [, child] of backgroundProcesses) {
      child.kill('SIGTERM')
    }
    backgroundProcesses.clear()
    sessionCache.clear()
    ownSessionIds.clear()
    if (daemonPid) {
      try { process.kill(daemonPid, 'SIGTERM') } catch { /* already gone */ }
      daemonPid = undefined
    }
  },
}
