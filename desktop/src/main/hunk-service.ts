import { execFile, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { realpathSync } from 'fs'
import type { HunkComment, HunkSessionInfo, HunkSessionContext } from '../shared/hunk-types'

export type { HunkComment, HunkSessionInfo, HunkSessionContext }

const execFileAsync = promisify(execFile)

const backgroundProcesses = new Map<string, ChildProcess>()
let hunkAvailableCache: boolean | null = null

function resolveRepo(worktreePath: string): string {
  try {
    return realpathSync(worktreePath)
  } catch {
    return worktreePath
  }
}

async function runHunk(args: string[], cwd?: string, timeout = 15_000): Promise<string> {
  const { stdout } = await execFileAsync('hunk', args, { cwd, timeout })
  return stdout.trim()
}

interface RawSessionGet { session: RawSession }
interface RawSessionList { sessions: RawSession[] }
interface RawSession {
  sessionId: string
  pid: number
  cwd: string
  repoRoot: string
  inputKind?: string
  title?: string
  sourceLabel?: string
}

interface RawContext {
  context: {
    sessionId?: string
    selectedFile?: { path?: string }
    selectedHunk?: { index?: number; oldRange?: number[]; newRange?: number[] }
    [key: string]: unknown
  }
}

interface RawCommentList {
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

function mapSession(raw: RawSession): HunkSessionInfo {
  return {
    id: raw.sessionId,
    path: raw.cwd,
    repo: raw.repoRoot,
    source: raw.sourceLabel,
  }
}

function mapComment(raw: RawCommentList['comments'][number]): HunkComment {
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

export const HunkService = {
  async isAvailable(): Promise<boolean> {
    if (hunkAvailableCache !== null) return hunkAvailableCache
    try {
      await execFileAsync('hunk', ['--version'], { timeout: 5000 })
      hunkAvailableCache = true
    } catch {
      hunkAvailableCache = false
    }
    return hunkAvailableCache
  },

  resetAvailabilityCache(): void {
    hunkAvailableCache = null
  },

  async startSession(worktreePath: string): Promise<void> {
    const repo = resolveRepo(worktreePath)
    if (backgroundProcesses.has(repo)) return

    const existing = await this.findSessionForRepo(repo)
    if (existing) return

    const child = spawn('hunk', ['diff', '--watch'], {
      cwd: repo,
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
    backgroundProcesses.set(repo, child)

    child.on('exit', () => {
      backgroundProcesses.delete(repo)
    })

    // Give the daemon a moment to register the session
    await new Promise((resolve) => setTimeout(resolve, 800))
  },

  async stopSession(worktreePath: string): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const child = backgroundProcesses.get(repo)
    if (child) {
      child.kill('SIGTERM')
      backgroundProcesses.delete(repo)
    }
  },

  async findSessionForRepo(worktreePath: string): Promise<HunkSessionInfo | null> {
    try {
      const repo = resolveRepo(worktreePath)
      const raw = await runHunk(['session', 'get', '--repo', repo, '--json'])
      const parsed = JSON.parse(raw) as RawSessionGet
      return mapSession(parsed.session)
    } catch {
      return null
    }
  },

  async listSessions(): Promise<HunkSessionInfo[]> {
    try {
      const raw = await runHunk(['session', 'list', '--json'])
      const parsed = JSON.parse(raw) as RawSessionList
      return parsed.sessions.map(mapSession)
    } catch {
      return []
    }
  },

  async getContext(worktreePath: string): Promise<HunkSessionContext | null> {
    try {
      const repo = resolveRepo(worktreePath)
      const raw = await runHunk(['session', 'context', '--repo', repo, '--json'])
      const parsed = JSON.parse(raw) as RawContext
      const ctx = parsed.context
      return {
        file: ctx.selectedFile?.path,
        hunk: ctx.selectedHunk?.index,
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
    opts?: { rationale?: string; author?: string; focus?: boolean },
  ): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const args = [
      'session', 'comment', 'add',
      '--repo', repo,
      '--file', file,
      '--new-line', String(newLine),
      '--summary', summary,
    ]
    if (opts?.rationale) args.push('--rationale', opts.rationale)
    if (opts?.author) args.push('--author', opts.author)
    if (opts?.focus) args.push('--focus')
    await runHunk(args)
  },

  async listComments(worktreePath: string, file?: string): Promise<HunkComment[]> {
    try {
      const repo = resolveRepo(worktreePath)
      const args = ['session', 'comment', 'list', '--repo', repo, '--json']
      if (file) args.push('--file', file)
      const raw = await runHunk(args)
      const parsed = JSON.parse(raw) as RawCommentList
      return parsed.comments.map(mapComment)
    } catch {
      return []
    }
  },

  async removeComment(worktreePath: string, commentId: string): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const session = await this.findSessionForRepo(repo)
    if (!session) throw new Error(`No hunk session for ${repo}`)
    await runHunk(['session', 'comment', 'rm', session.id, commentId])
  },

  async clearComments(worktreePath: string, file?: string): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const args = ['session', 'comment', 'clear', '--repo', repo, '--yes']
    if (file) args.push('--file', file)
    await runHunk(args)
  },

  async navigate(
    worktreePath: string,
    file: string,
    target: { hunk?: number; newLine?: number; oldLine?: number },
  ): Promise<void> {
    const repo = resolveRepo(worktreePath)
    const args = ['session', 'navigate', '--repo', repo, '--file', file]
    if (target.hunk != null) args.push('--hunk', String(target.hunk))
    else if (target.newLine != null) args.push('--new-line', String(target.newLine))
    else if (target.oldLine != null) args.push('--old-line', String(target.oldLine))
    await runHunk(args)
  },

  async reload(worktreePath: string, command: string[]): Promise<void> {
    const repo = resolveRepo(worktreePath)
    await runHunk(['session', 'reload', '--repo', repo, '--', ...command])
  },

  cleanupAll(): void {
    for (const [, child] of backgroundProcesses) {
      child.kill('SIGTERM')
    }
    backgroundProcesses.clear()
  },
}
