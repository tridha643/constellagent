import { execFile, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import type { HunkComment, HunkSessionInfo, HunkSessionContext } from '../shared/hunk-types'

export type { HunkComment, HunkSessionInfo, HunkSessionContext }

const execFileAsync = promisify(execFile)

const backgroundProcesses = new Map<string, ChildProcess>()
let hunkAvailableCache: boolean | null = null

async function runHunk(args: string[], cwd?: string, timeout = 15_000): Promise<string> {
  const { stdout } = await execFileAsync('hunk', args, { cwd, timeout })
  return stdout.trim()
}

function parseJsonOutput<T>(raw: string): T {
  return JSON.parse(raw) as T
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
    if (backgroundProcesses.has(worktreePath)) return

    const existing = await this.findSessionForRepo(worktreePath)
    if (existing) return

    const child = spawn('hunk', ['diff', '--watch'], {
      cwd: worktreePath,
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
    backgroundProcesses.set(worktreePath, child)

    child.on('exit', () => {
      backgroundProcesses.delete(worktreePath)
    })

    // Give the daemon a moment to register the session
    await new Promise((resolve) => setTimeout(resolve, 800))
  },

  async stopSession(worktreePath: string): Promise<void> {
    const child = backgroundProcesses.get(worktreePath)
    if (child) {
      child.kill('SIGTERM')
      backgroundProcesses.delete(worktreePath)
    }
  },

  async findSessionForRepo(worktreePath: string): Promise<HunkSessionInfo | null> {
    try {
      const raw = await runHunk(['session', 'get', '--repo', worktreePath, '--json'])
      return parseJsonOutput<HunkSessionInfo>(raw)
    } catch {
      return null
    }
  },

  async listSessions(): Promise<HunkSessionInfo[]> {
    try {
      const raw = await runHunk(['session', 'list', '--json'])
      return parseJsonOutput<HunkSessionInfo[]>(raw)
    } catch {
      return []
    }
  },

  async getContext(worktreePath: string): Promise<HunkSessionContext | null> {
    try {
      const raw = await runHunk(['session', 'context', '--repo', worktreePath, '--json'])
      return parseJsonOutput<HunkSessionContext>(raw)
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
    const args = [
      'session', 'comment', 'add',
      '--repo', worktreePath,
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
      const args = ['session', 'comment', 'list', '--repo', worktreePath]
      if (file) args.push('--file', file)
      const raw = await runHunk(args)
      return parseJsonOutput<HunkComment[]>(raw)
    } catch {
      return []
    }
  },

  async removeComment(worktreePath: string, commentId: string): Promise<void> {
    await runHunk(['session', 'comment', 'rm', '--repo', worktreePath, commentId])
  },

  async clearComments(worktreePath: string, file?: string): Promise<void> {
    const args = ['session', 'comment', 'clear', '--repo', worktreePath, '--yes']
    if (file) args.push('--file', file)
    await runHunk(args)
  },

  async navigate(
    worktreePath: string,
    file: string,
    target: { hunk?: number; newLine?: number; oldLine?: number },
  ): Promise<void> {
    const args = ['session', 'navigate', '--repo', worktreePath, '--file', file]
    if (target.hunk != null) args.push('--hunk', String(target.hunk))
    else if (target.newLine != null) args.push('--new-line', String(target.newLine))
    else if (target.oldLine != null) args.push('--old-line', String(target.oldLine))
    await runHunk(args)
  },

  async reload(worktreePath: string, command: string[]): Promise<void> {
    await runHunk(['session', 'reload', '--repo', worktreePath, '--', ...command])
  },

  cleanupAll(): void {
    for (const [path, child] of backgroundProcesses) {
      child.kill('SIGTERM')
      backgroundProcesses.delete(path)
    }
  },
}
