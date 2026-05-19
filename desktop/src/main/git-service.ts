import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { lstat, open, readFile, readlink, readdir, realpath, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { promisify } from 'util'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import type { CreateWorktreeProgress } from '../shared/workspace-creation'
import type { GitLogEntry, WorktreeInfo } from '../shared/git-types'
import type { SyncProgress, SyncResult } from '../shared/sync-types'
import type { WorktreeCredentialRule } from '../shared/worktree-credentials'
import type { GitHunkActionRequest } from '../shared/git-hunk-action-types'
import type {
  CloneRepoOptions,
  CloneRepoProgress,
  CloneRepoResult,
} from '../shared/clone-repo'
import { CLONE_ERROR_CODES } from '../shared/clone-repo'
import type { ChildProcess } from 'child_process'
import { buildSingleHunkGitPatch } from '../shared/git-hunk-patch'
import { copyWorktreeCredentialArtifacts } from './worktree-credential-copy'

const execFileAsync = promisify(execFile)

type CreateWorktreeProgressReporter = (progress: CreateWorktreeProgress) => void

export interface FileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
}

export interface FileDiff {
  path: string
  hunks: string // raw unified diff text
}

export interface PrWorktreeResult {
  worktreePath: string
  branch: string
  pushRemote: string
  pushRef: string
}

export interface CreatePrWorktreeOptions {
  headRefName?: string
  headRemoteName?: string
  headRemoteUrl?: string
}

async function git(args: string[], cwd: string): Promise<string> {
  return spawnAndCapture('git', args, cwd, 10 * 1024 * 1024)
}

/**
 * Run git with custom env vars layered on top of `process.env`. Used by
 * SpotlightService where we set `GIT_INDEX_FILE` to keep the worktree's
 * canonical index untouched while we build a checkpoint tree.
 */
async function spawnAndCaptureWithEnv(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf8') })
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf8') })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      rejectPromise(err)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      if (code === 0) resolvePromise(stdout.trimEnd())
      else rejectPromise(Object.assign(new Error(`${command} exited with code ${code ?? signal}`), { code, signal, stdout, stderr }))
    })
  })
}

export interface SpotlightRootSnapshot {
  /** HEAD ref at the moment Spotlight engaged. */
  head: string
  /** `git stash create` SHA of pre-spotlight uncommitted root work; null if root was clean. */
  stashSha: string | null
}

function isSpawnEbadf(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as NodeJS.ErrnoException
  return e.code === 'EBADF' && e.syscall === 'spawn'
}

/** POSIX single-quoted string for `sh -c` (incl. newlines in path). */
function shellQuotePosix(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

let loggedGitSpawnFallback = false

function logGitSpawnFallbackOnce(which: 'files' | 'shell'): void {
  if (loggedGitSpawnFallback) return
  loggedGitSpawnFallback = true
  console.warn(
    `[constellagent] git subprocess used ${which} fallback after spawn EBADF (macOS/Electron + libuv); see git-service spawn fallbacks`,
  )
}

/**
 * Last-resort: spawn `/bin/sh` with stdio fully ignored; the shell redirects git output to temp
 * files. When even fd-based stdio fails with EBADF, Node never opens pipe endpoints for the child.
 */
async function spawnAndCaptureViaShellIgnore(
  command: string,
  args: string[],
  cwd: string,
  maxBuffer: number,
): Promise<string> {
  if (process.platform === 'win32') {
    throw new Error(`${command}: spawn EBADF — no sh-based fallback on Windows`)
  }

  const id = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const outPath = join(tmpdir(), `ca-sh-out-${id}.txt`)
  const codePath = join(tmpdir(), `ca-sh-code-${id}.txt`)
  const q = shellQuotePosix
  const script = `cd ${q(cwd)} && ${q(command)} ${args.map(q).join(' ')} > ${q(outPath)} 2>&1; printf %s "$?" > ${q(codePath)}`

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false
    const child = spawn('/bin/sh', ['-c', script], {
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      rejectPromise(err)
    })
    child.on('close', () => {
      if (settled) return
      settled = true
      resolvePromise()
    })
  })

  let stdout = ''
  let codeRaw = ''
  try {
    stdout = await readFile(outPath, 'utf8')
    codeRaw = (await readFile(codePath, 'utf8')).trim()
  } finally {
    await rm(outPath, { force: true }).catch(() => {})
    await rm(codePath, { force: true }).catch(() => {})
  }

  const bufferedBytes = Buffer.byteLength(stdout, 'utf8')
  if (bufferedBytes > maxBuffer) {
    throw Object.assign(new Error(`${command} output exceeded ${maxBuffer} bytes`), {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    })
  }

  const exitCode = codeRaw === '' || Number.isNaN(Number(codeRaw)) ? null : Number(codeRaw)
  if (exitCode === 0) return stdout.trimEnd()

  throw Object.assign(new Error(`${command} exited with code ${exitCode ?? 'unknown'}`), {
    code: exitCode,
    stdout,
  })
}

/**
 * Capture stdout/stderr via real files instead of Node pipes. macOS + long-running Electron
 * can hit `spawn EBADF` when libuv sets up pipe stdio; passing file descriptors avoids that path.
 */
async function spawnAndCaptureViaFiles(
  command: string,
  args: string[],
  cwd: string,
  maxBuffer: number,
): Promise<string> {
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const stdoutPath = join(tmpdir(), `ca-git-out-${id}.txt`)
  const stderrPath = join(tmpdir(), `ca-git-err-${id}.txt`)
  const stdoutFh = await open(stdoutPath, 'w')
  const stderrFh = await open(stderrPath, 'w')
  let exitCode: number | null = null
  let exitSignal: NodeJS.Signals | null = null
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false
      const child = spawn(command, args, {
        cwd,
        stdio: ['ignore', stdoutFh.fd, stderrFh.fd],
        windowsHide: true,
      })
      child.on('error', (err) => {
        if (settled) return
        settled = true
        rejectPromise(err)
      })
      child.on('close', (code, signal) => {
        if (settled) return
        settled = true
        exitCode = code
        exitSignal = signal
        resolvePromise()
      })
    })
  } finally {
    await stdoutFh.close().catch(() => {})
    await stderrFh.close().catch(() => {})
  }

  let stdout = ''
  let stderr = ''
  try {
    stdout = await readFile(stdoutPath, 'utf8')
    stderr = await readFile(stderrPath, 'utf8')
  } finally {
    await rm(stdoutPath, { force: true }).catch(() => {})
    await rm(stderrPath, { force: true }).catch(() => {})
  }

  const bufferedBytes = Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(stderr, 'utf8')
  if (bufferedBytes > maxBuffer) {
    throw Object.assign(new Error(`${command} output exceeded ${maxBuffer} bytes`), {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    })
  }

  if (exitCode === 0) return stdout.trimEnd()

  throw Object.assign(new Error(`${command} exited with code ${exitCode ?? exitSignal}`), {
    code: exitCode,
    signal: exitSignal,
    stdout,
    stderr,
  })
}

function spawnAndCaptureWithPipes(
  command: string,
  args: string[],
  cwd: string,
  maxBuffer: number,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    // Keep stdin closed explicitly. Electron dev can surface EBADF from execFile's
    // implicit stdio setup before git starts, which breaks status/worktree IPC.
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let bufferedBytes = 0
    let settled = false

    const reject = (
      err: Error & { stdout?: string; stderr?: string; code?: string | number | null; signal?: NodeJS.Signals | null },
    ) => {
      if (settled) return
      settled = true
      err.stdout = stdout
      err.stderr = stderr
      rejectPromise(err)
    }

    const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      bufferedBytes += chunk.byteLength
      if (bufferedBytes > maxBuffer) {
        child.kill()
        reject(
          Object.assign(new Error(`${command} output exceeded ${maxBuffer} bytes`), {
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          }),
        )
        return
      }
      if (stream === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }

    child.stdout?.on('data', (chunk: Buffer) => collect('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => collect('stderr', chunk))
    child.on('error', (err) => reject(err))
    child.on('close', (code, signal) => {
      if (settled) return
      if (code === 0) {
        settled = true
        resolvePromise(stdout.trimEnd())
        return
      }

      reject(Object.assign(new Error(`${command} exited with code ${code ?? signal}`), { code, signal }))
    })
  })
}

async function spawnAndCapture(command: string, args: string[], cwd: string, maxBuffer: number): Promise<string> {
  const attempts: Array<{ name: 'pipes' | 'files' | 'shell'; run: () => Promise<string> }> = [
    { name: 'pipes', run: () => spawnAndCaptureWithPipes(command, args, cwd, maxBuffer) },
    { name: 'files', run: () => spawnAndCaptureViaFiles(command, args, cwd, maxBuffer) },
    { name: 'shell', run: () => spawnAndCaptureViaShellIgnore(command, args, cwd, maxBuffer) },
  ]

  let lastErr: unknown
  for (let i = 0; i < attempts.length; i++) {
    try {
      const out = await attempts[i].run()
      if (i > 0) logGitSpawnFallbackOnce(attempts[i].name === 'shell' ? 'shell' : 'files')
      return out
    } catch (err) {
      lastErr = err
      if (!isSpawnEbadf(err)) throw err
    }
  }
  throw lastErr
}

/** Module-level registry of in-flight clone child processes, keyed by requestId, so Cancel can SIGTERM them. */
const cloneProcesses = new Map<string, ChildProcess>()

/**
 * Spawn a process, buffer stdout, and stream stderr line-by-line to a callback.
 * Used for `git clone --progress` where stderr carries the human-readable progress feed.
 * Stores the child in `cloneProcesses` under `requestId` when provided so it can be cancelled.
 */
function spawnAndStreamStderr(
  command: string,
  args: string[],
  cwd: string,
  opts: {
    onStderrLine?: (line: string) => void
    env?: NodeJS.ProcessEnv
    requestId?: string
  } = {},
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: opts.env ?? process.env,
    })

    if (opts.requestId) cloneProcesses.set(opts.requestId, child)

    let stdout = ''
    let stderrBuf = ''
    let stderrRemainder = ''
    let settled = false

    const cleanup = () => {
      if (opts.requestId && cloneProcesses.get(opts.requestId) === child) {
        cloneProcesses.delete(opts.requestId)
      }
    }

    const reject = (
      err: Error & { stdout?: string; stderr?: string; code?: string | number | null; signal?: NodeJS.Signals | null },
    ) => {
      if (settled) return
      settled = true
      err.stdout = stdout
      err.stderr = stderrBuf
      cleanup()
      rejectPromise(err)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderrBuf += text
      if (!opts.onStderrLine) return
      // Git emits progress lines terminated by \r; split on both.
      const combined = stderrRemainder + text
      const parts = combined.split(/\r\n|\r|\n/)
      stderrRemainder = parts.pop() ?? ''
      for (const part of parts) {
        if (part.length > 0) opts.onStderrLine(part)
      }
    })

    child.on('error', (err) => reject(err))
    child.on('close', (code, signal) => {
      if (settled) return
      if (opts.onStderrLine && stderrRemainder.length > 0) {
        opts.onStderrLine(stderrRemainder)
      }
      if (code === 0) {
        settled = true
        cleanup()
        resolvePromise(stdout.trimEnd())
        return
      }
      reject(Object.assign(new Error(`${command} exited with code ${code ?? signal}`), { code, signal }))
    })
  })
}

function buildSyntheticSymlinkPatch(filePath: string, target: string): string {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 120000',
    'index 0000000..0000000',
    '--- /dev/null',
    `+++ b/${filePath}`,
    '@@ -0,0 +1 @@',
    `+${target}`,
  ].join('\n')
}

async function applyGitPatch(worktreePath: string, patch: string, args: string[], fallbackError: string): Promise<void> {
  const tempPath = join(
    tmpdir(),
    `constellagent-hunk-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`,
  )
  await writeFile(tempPath, patch, 'utf-8')
  try {
    await git(['apply', ...args, tempPath], worktreePath)
  } catch (err) {
    throw new Error(friendlyGitError(err, fallbackError))
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

/** Extract a user-friendly message from a git exec error */
function friendlyGitError(err: unknown, fallback: string): string {
  const stderr =
    typeof err === 'object' && err !== null && 'stderr' in err
      ? String((err as { stderr?: unknown }).stderr ?? '')
      : undefined
  if (!stderr) return fallback

  // "fatal: 'branch' is already used by worktree at '/path'"
  const alreadyUsed = stderr.match(/fatal: '([^']+)' is already (?:checked out|used by worktree) at '([^']+)'/)
  if (alreadyUsed) return 'BRANCH_CHECKED_OUT'

  // "fatal: invalid reference: branch-name"
  if (stderr.includes('invalid reference')) {
    const ref = stderr.match(/invalid reference: (.+)/)?.[1]?.trim()
    return ref ? `Branch "${ref}" not found` : 'Branch not found'
  }

  // "fatal: a branch named 'X' already exists"
  if (stderr.includes('a branch named')) return 'BRANCH_ALREADY_EXISTS'

  // "fatal: '/path' already exists"
  if (stderr.includes('already exists')) return 'WORKTREE_PATH_EXISTS'

  // "fatal: not a git repository"
  if (stderr.includes('not a git repository')) return 'Not a git repository'

  // Clone: auth failed / prompts disabled / private repo without creds
  if (
    /Authentication failed/i.test(stderr) ||
    /could not read Username/i.test(stderr) ||
    /terminal prompts disabled/i.test(stderr) ||
    /Permission denied \(publickey\)/i.test(stderr)
  ) {
    return CLONE_ERROR_CODES.AUTH_FAILED
  }

  // Clone: network reachability
  if (
    /Could not resolve host/i.test(stderr) ||
    /Connection refused/i.test(stderr) ||
    /Connection timed out/i.test(stderr) ||
    /Operation timed out/i.test(stderr) ||
    /Failed to connect to/i.test(stderr)
  ) {
    return CLONE_ERROR_CODES.NETWORK
  }

  // Clone: repo missing or no access
  if (/Repository not found/i.test(stderr) || /ERROR: Repository not found/i.test(stderr)) {
    return CLONE_ERROR_CODES.NOT_FOUND
  }

  // Generic: grab the fatal line
  const fatal = stderr.match(/fatal: (.+)/)?.[1]?.trim()
  if (fatal) return fatal

  return fallback
}

/** Sanitize user-facing workspace names for safe filesystem directory names */
function sanitizeWorktreeName(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80)
  return sanitized || 'workspace'
}

function ensureWithinParent(parentDir: string, candidatePath: string): void {
  const relPath = relative(parentDir, candidatePath)
  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error('Invalid workspace name')
  }
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const relPath = relative(parentDir, candidatePath)
  return relPath.length > 0 && !relPath.startsWith('..') && !isAbsolute(relPath)
}

const DEFAULT_GITIGNORE = [
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  '.DS_Store',
  '*.log',
].join('\n') + '\n'

function reportCreateWorktreeProgress(
  onProgress: CreateWorktreeProgressReporter | undefined,
  progress: CreateWorktreeProgress
): void {
  onProgress?.(progress)
}

/**
 * Thrown by `GitService.fetchAndRebase` when `git rebase` exits with content
 * conflicts. The rebase is left mid-flight on disk — callers decide whether to
 * abort or hand off to an agent.
 */
export class RebaseConflictError extends Error {
  readonly conflictedFiles: string[]
  constructor(conflictedFiles: string[]) {
    super(
      conflictedFiles.length > 0
        ? `Rebase conflict in ${conflictedFiles.length} file(s)`
        : 'Rebase conflict',
    )
    this.name = 'RebaseConflictError'
    this.conflictedFiles = conflictedFiles
  }
}

export class GitService {
  private static async hasRemote(repoPath: string, remoteName: string): Promise<boolean> {
    return git(['remote', 'get-url', remoteName], repoPath).then(
      () => true,
      () => false,
    )
  }

  static async isGitRepo(dirPath: string): Promise<boolean> {
    return git(['rev-parse', '--show-toplevel'], dirPath).then(
      () => true,
      () => false,
    )
  }

  static async initRepo(dirPath: string): Promise<void> {
    if (await this.isGitRepo(dirPath)) {
      throw new Error('Directory is already inside a git repository')
    }

    try {
      await git(['init'], dirPath)

      const gitignorePath = join(dirPath, '.gitignore')
      if (!existsSync(gitignorePath)) {
        await writeFile(gitignorePath, DEFAULT_GITIGNORE, 'utf-8')
      }

      await git(['add', '.gitignore'], dirPath)
      await git([
        '-c', 'user.name=Constellagent',
        '-c', 'user.email=noreply@constellagent',
        'commit',
        '--no-gpg-sign',
        '--no-verify',
        '-m', 'Initial commit',
      ], dirPath)
    } catch (err) {
      throw new Error(friendlyGitError(err, 'Failed to initialize repository'))
    }
  }

  /**
   * Clone a remote repository into `destPath`. Full-history clone (worktree creation
   * later requires non-default branches). Progress is streamed stage-by-stage through
   * `onProgress`; during the `cloning` stage, percent values are extracted from git's
   * stderr `--progress` output. Use `cancelClone(requestId)` to abort.
   */
  static async cloneRepo(
    opts: CloneRepoOptions,
    onProgress?: (progress: CloneRepoProgress) => void,
  ): Promise<CloneRepoResult> {
    const { url, destPath, requestId } = opts

    onProgress?.({ stage: 'validate-url', message: 'Validating URL…' })

    // Prepare destination. Fail fast if the path exists and is non-empty (caller
    // has already distinguished between "empty dir" / "existing repo" / "non-empty" via IPC pre-checks).
    onProgress?.({ stage: 'prepare-destination', message: 'Preparing destination…' })
    const parent = dirname(destPath)
    if (!existsSync(parent)) {
      throw new Error('Parent directory does not exist')
    }
    if (existsSync(destPath)) {
      const entries = await readdir(destPath).catch(() => [])
      if (entries.length > 0) {
        // The renderer may choose to fall through to "Add existing repo" before reaching us;
        // by the time we are here, this is an unrecoverable collision.
        throw new Error(CLONE_ERROR_CODES.DEST_EXISTS_NON_EMPTY)
      }
    }

    onProgress?.({ stage: 'cloning', message: 'Starting clone…', percent: 0 })

    try {
      await spawnAndStreamStderr(
        'git',
        ['clone', '--progress', '--no-single-branch', url, destPath],
        parent,
        {
          requestId,
          env: {
            ...process.env,
            // Fail fast on missing credentials instead of hanging for an interactive prompt.
            GIT_TERMINAL_PROMPT: '0',
            // Disable macOS/Windows graphical credential popups so auth failures surface as errors.
            GIT_ASKPASS: 'echo',
            SSH_ASKPASS: 'echo',
          },
          onStderrLine: (line) => {
            const match = line.match(
              /^(Receiving objects|Resolving deltas|Counting objects|Compressing objects):\s+(\d+)%/,
            )
            if (match) {
              onProgress?.({
                stage: 'cloning',
                message: line,
                percent: Math.min(100, Math.max(0, Number(match[2]))),
              })
            } else if (line.trim().length > 0) {
              onProgress?.({ stage: 'cloning', message: line })
            }
          },
        },
      )
    } catch (err) {
      // Clean up partial checkout so retry works.
      await rm(destPath, { recursive: true, force: true }).catch(() => {})

      const signal = typeof err === 'object' && err !== null ? (err as { signal?: NodeJS.Signals | null }).signal : null
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        throw new Error(CLONE_ERROR_CODES.CANCELLED)
      }
      throw new Error(friendlyGitError(err, 'Failed to clone repository'))
    }

    onProgress?.({ stage: 'finalizing', message: 'Finalizing…', percent: 100 })

    // Canonicalize path (handles macOS /private symlink + user-supplied case) and read HEAD branch.
    let repoPath: string
    try {
      repoPath = await realpath(destPath)
    } catch {
      repoPath = resolve(destPath)
    }

    let defaultBranch = ''
    try {
      defaultBranch = (await git(['symbolic-ref', '--short', 'HEAD'], repoPath)).trim()
    } catch {
      // Detached HEAD or no commits — not critical; caller treats empty as "unknown".
      defaultBranch = ''
    }

    return { repoPath, defaultBranch }
  }

  /**
   * Cancel an in-flight clone. Returns `true` if a matching request was found and signalled.
   * The `cloneRepo` call will reject with `CLONE_CANCELLED` and the partial destination is cleaned up.
   */
  static cancelClone(requestId: string): boolean {
    const child = cloneProcesses.get(requestId)
    if (!child) return false
    try {
      child.kill('SIGTERM')
    } catch {
      return false
    }
    return true
  }

  static async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const cwd = (repoPath ?? '').trim()
    if (!cwd.length) return []
    if (!existsSync(cwd)) return []

    const worktrees: WorktreeInfo[] = []
    try {
      const output = await git(['worktree', 'list', '--porcelain'], cwd)
      if (output) {
        const blocks = output.split('\n\n')
        for (const block of blocks) {
          const lines = block.split('\n')
          const info: Partial<WorktreeInfo> = { isBare: false, isDetached: false }
          for (const rawLine of lines) {
            const line = rawLine.trimEnd()
            if (line.startsWith('worktree ')) info.path = line.slice(9)
            else if (line.startsWith('HEAD ')) info.head = line.slice(5)
            else if (line.startsWith('branch ')) info.branch = line.slice(7).replace('refs/heads/', '')
            else if (line === 'bare') info.isBare = true
            else if (line === 'detached') info.isDetached = true
          }
          if (info.path) {
            worktrees.push({
              path: info.path,
              branch: info.branch ?? '',
              head: info.head ?? '',
              isBare: info.isBare ?? false,
              isDetached: info.isDetached || undefined,
            })
          }
        }
      }
    } catch (err) {
      // Keep renderer IPC best-effort, but log enough context to diagnose empty sidebars.
      console.warn('[constellagent] git worktree list failed', {
        cwd,
        error: friendlyGitError(err, 'Failed to list worktrees'),
      })
    }

    // t3 sandboxes: merge even when porcelain failed or omitted paths (no extra IPC).
    try {
      const t3 = await GitService.discoverT3Worktrees(cwd)
      for (const w of t3) {
        if (!worktrees.some((x) => x.path === w.path)) {
          worktrees.push(w)
        }
      }
    } catch {
      /* best-effort */
    }

    return worktrees
  }

  /**
   * Directories under `~/.t3/worktrees/<repoDirName>/` that share the same resolved
   * `--git-common-dir` as `repoPath` (t3 agent sandboxes). Catches checkouts that are
   * missing from `git worktree list` or only appear as detached.
   */
  static async discoverT3Worktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const cwd = (repoPath ?? '').trim()
    if (!cwd.length || !existsSync(cwd)) return []

    const mainCommon = await GitService.getResolvedGitCommonDir(cwd)
    if (!mainCommon) return []

    const repoAnchor = await GitService.getProjectRepoAnchor(cwd)
    const repoDirName = basename(repoAnchor || resolve(cwd))

    const t3Root = join(homedir(), '.t3', 'worktrees', repoDirName)
    if (!existsSync(t3Root)) return []

    let entries
    try {
      entries = await readdir(t3Root, { withFileTypes: true })
    } catch {
      return []
    }

    const out: WorktreeInfo[] = []
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const candidate = join(t3Root, ent.name)
      const common = await GitService.getResolvedGitCommonDir(candidate)
      if (common !== mainCommon) continue

      let branch = ''
      try {
        branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], candidate)).trim()
      } catch {
        branch = ''
      }
      const head = await git(['rev-parse', 'HEAD'], candidate).catch(() => '')
      const isDetached = branch === 'HEAD' || !branch

      out.push({
        path: candidate,
        branch: isDetached ? '' : branch,
        head,
        isBare: false,
        isDetached: isDetached || undefined,
      })
    }
    return out
  }

  private static async getResolvedGitCommonDir(cwd: string): Promise<string | null> {
    if (!existsSync(cwd)) return null
    try {
      const rel = await git(['rev-parse', '--git-common-dir'], cwd)
      const joined = resolve(cwd, rel.trim())
      return await realpath(joined)
    } catch {
      return null
    }
  }

  static async pruneWorktrees(repoPath: string): Promise<void> {
    await git(['worktree', 'prune', '--expire', 'now'], repoPath).catch(() => {})
  }

  private static async readLinkedWorktreeGitdir(worktreePath: string): Promise<string | null> {
    const gitPath = join(worktreePath, '.git')
    if (!existsSync(gitPath)) return null

    try {
      const raw = await readFile(gitPath, 'utf8')
      const match = raw.match(/^gitdir:\s*(.+)\s*$/i)
      if (!match) return null
      return resolve(worktreePath, match[1].trim())
    } catch {
      return null
    }
  }

  /**
   * Replace an existing workspace path without leaving broken linked-worktree state behind.
   * Prefer Git-native removal, fall back to filesystem cleanup only for orphaned linked
   * worktrees owned by this repo or for plain directories with no git metadata.
   */
  static async removeExistingWorkspacePath(repoPath: string, worktreePath: string): Promise<void> {
    if (!existsSync(worktreePath)) return

    const [repoRealPath, worktreeRealPath] = await Promise.all([
      realpath(repoPath).catch(() => resolve(repoPath)),
      realpath(worktreePath).catch(() => resolve(worktreePath)),
    ])
    if (repoRealPath === worktreeRealPath) {
      throw new Error('Refusing to replace the primary repository directory')
    }

    try {
      await git(['worktree', 'remove', '--force', worktreePath], repoPath)
      await GitService.pruneWorktrees(repoPath)
      return
    } catch {
      // Fall through to orphan/non-git cleanup.
    }

    const linkedGitdir = await GitService.readLinkedWorktreeGitdir(worktreePath)
    if (linkedGitdir) {
      const commonDir = await GitService.getResolvedGitCommonDir(repoPath)
      const worktreesDir = commonDir ? join(commonDir, 'worktrees') : null
      if (worktreesDir && isPathInside(worktreesDir, linkedGitdir)) {
        await rm(worktreePath, { recursive: true, force: true })
        await GitService.pruneWorktrees(repoPath)
        return
      }
      throw new Error('Existing workspace path is another git worktree; refusing to delete it automatically')
    }

    if (await GitService.isGitRepo(worktreePath)) {
      throw new Error('Existing workspace path is a standalone git repository; refusing to delete it automatically')
    }

    if (existsSync(join(worktreePath, '.git'))) {
      throw new Error('Existing workspace path contains git metadata; refusing to delete it automatically')
    }

    await rm(worktreePath, { recursive: true, force: true })
  }

  /**
   * Canonical project anchor for app-level repo state.
   * For linked worktrees, prefer the primary checkout root that owns the shared `.git`.
   */
  static async getProjectRepoAnchor(dirPath: string): Promise<string> {
    const cwd = (dirPath ?? '').trim()
    if (!cwd.length) return ''

    let fallback = resolve(cwd)
    try {
      fallback = await realpath(cwd)
    } catch {
      /* best-effort */
    }
    if (!existsSync(cwd)) return fallback

    try {
      const topLevelRaw = (await GitService.getTopLevel(cwd)).trim()
      const topLevel = await realpath(topLevelRaw).catch(() => resolve(topLevelRaw))
      const commonDir = await GitService.getResolvedGitCommonDir(cwd)
      if (!commonDir || basename(commonDir) !== '.git') return topLevel

      const primaryRoot = dirname(commonDir)
      return await realpath(primaryRoot).catch(() => resolve(primaryRoot))
    } catch {
      return fallback
    }
  }

  /** Sanitize a string into a valid git branch name */
  static sanitizeBranchName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, '-')       // spaces → dashes
      .replace(/\.{2,}/g, '-')    // consecutive dots (..)
      .replace(/[\x00-\x1f\x7f~^:?*[\]\\]/g, '-') // control chars & git-illegal chars
      .replace(/\/{2,}/g, '/')    // collapse consecutive slashes
      .replace(/\/\./g, '/-')     // no component starting with dot
      .replace(/@\{/g, '-')       // no @{
      .replace(/\.lock(\/|$)/g, '-lock$1') // no .lock component
      .replace(/^[.\-/]+/, '')    // no leading dot, dash, or slash
      .replace(/[.\-/]+$/, '')    // no trailing dot, dash, or slash
  }

  private static sanitizeRemoteName(name: string): string {
    return name
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
  }

  /**
   * Picks a local branch name under `preferred` that does not yet exist in `repoPath`.
   */
  private static async allocateUniqueLocalBranchName(repoPath: string, preferred: string): Promise<string> {
    const base = GitService.sanitizeBranchName(preferred).slice(0, 220)
    if (!base) throw new Error('Branch name is empty after sanitization')
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? base : `${base}-${i}`
      const exists = await git(['rev-parse', '--verify', `refs/heads/${candidate}`], repoPath)
        .then(() => true, () => false)
      if (!exists) return candidate
    }
    throw new Error('Could not allocate a unique branch name')
  }

  static async getDefaultBranch(repoPath: string): Promise<string> {
    const hasOrigin = await this.hasRemote(repoPath, 'origin')

    if (hasOrigin) {
      // Best effort sync of origin/HEAD. Network hiccups should not block worktree creation.
      await git(['remote', 'set-head', 'origin', '--auto'], repoPath).catch(() => {})

      const ref = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoPath).catch(() => '')
      // "refs/remotes/origin/main" → "origin/main"
      if (ref) return ref.replace('refs/remotes/', '')

      // Fallback for repos where origin/HEAD is unset.
      for (const candidate of ['origin/main', 'origin/master', 'origin/production']) {
        const exists = await git(['rev-parse', '--verify', `refs/remotes/${candidate}`], repoPath)
          .then(() => true, () => false)
        if (exists) return candidate
      }
    }

    const local = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath).catch(() => '')
    if (local && local !== 'HEAD') return local

    for (const candidate of ['main', 'master', 'production']) {
      const exists = await git(['rev-parse', '--verify', `refs/heads/${candidate}`], repoPath)
        .then(() => true, () => false)
      if (exists) return candidate
    }

    return 'main'
  }

  static async createWorktree(
    repoPath: string,
    name: string,
    branch: string,
    newBranch: boolean,
    baseBranch?: string,
    force = false,
    onProgress?: CreateWorktreeProgressReporter,
    credentialRules?: WorktreeCredentialRule[],
  ): Promise<string> {
    const requestedBranch = branch.trim()
    branch = GitService.sanitizeBranchName(requestedBranch)
    if (!branch) throw new Error('Branch name is empty after sanitization')

    const parentDir = dirname(repoPath)
    const repoName = basename(repoPath)
    const safeWorktreeName = sanitizeWorktreeName(name)
    const worktreePath = resolve(parentDir, `${repoName}-ws-${safeWorktreeName}`)
    ensureWithinParent(parentDir, worktreePath)

    // Clean up stale worktree refs
    reportCreateWorktreeProgress(onProgress, {
      stage: 'prune-worktrees',
      message: 'Cleaning stale worktree references...',
    })
    await GitService.pruneWorktrees(repoPath)

    const hasOrigin = await GitService.hasRemote(repoPath, 'origin')

    // Fetch remote refs so worktree branches from latest state
    reportCreateWorktreeProgress(onProgress, {
      stage: 'fetch-origin',
      message: hasOrigin ? 'Syncing remote...' : 'No origin remote found; using local refs...',
    })
    if (hasOrigin) {
      // Best effort: local repos (or temporary network failures) should still work.
      await git(['fetch', '--prune', 'origin'], repoPath).catch(() => {})
    }

    // Auto-detect base branch when creating a new branch without explicit base
    if (newBranch && !baseBranch) {
      reportCreateWorktreeProgress(onProgress, {
        stage: 'resolve-default-branch',
        message: 'Resolving default base branch...',
      })
      baseBranch = await GitService.getDefaultBranch(repoPath)
    }

    reportCreateWorktreeProgress(onProgress, {
      stage: 'prepare-worktree-dir',
      message: 'Preparing worktree directory...',
    })
    if (existsSync(worktreePath)) {
      if (!force) {
        throw new Error('WORKTREE_PATH_EXISTS')
      }
      await GitService.removeExistingWorkspacePath(repoPath, worktreePath)
    }

    // Pre-check if branch exists so we never need -b retry
    reportCreateWorktreeProgress(onProgress, {
      stage: 'inspect-branch',
      message: 'Checking branch state...',
    })
    let branchExists = await git(['rev-parse', '--verify', `refs/heads/${branch}`], repoPath)
      .then(() => true, () => false)

    // If checking out an existing branch that doesn't exist locally or on origin,
    // try fetching it as a GitHub PR branch (fork PRs aren't included in normal fetch)
    if (!newBranch && !branchExists) {
      const remoteExists = hasOrigin
        ? await git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], repoPath)
            .then(() => true, () => false)
        : false
      if (!remoteExists) {
        try {
          const headCandidates = [requestedBranch]
          if (requestedBranch.includes(':')) {
            const prBranch = requestedBranch.split(':')[1]
            if (prBranch && !headCandidates.includes(prBranch)) headCandidates.push(prBranch)
          }
          if (!headCandidates.includes(branch)) headCandidates.push(branch)

          let prNumber = ''
          for (const headCandidate of headCandidates) {
            const { stdout } = await execFileAsync('gh', [
              // Resolve repo from cwd for broad gh CLI compatibility.
              'pr', 'list', '--head', headCandidate, '--json', 'number',
              '--jq', '.[0].number',
            ], { cwd: repoPath })
            prNumber = stdout.trim()
            if (prNumber) break
          }
          if (prNumber) {
            await git(['fetch', 'origin', `pull/${prNumber}/head:${branch}`], repoPath)
            branchExists = true
          }
        } catch {
          // gh not available or no matching PR — fall through to normal error
        }
      }
    }

    const args = ['worktree', 'add']
    if (force) args.push('--force')
    if (newBranch && !branchExists) {
      args.push('-b', branch, worktreePath)
      if (baseBranch) args.push(baseBranch)
    } else if (newBranch && branchExists) {
      // `git worktree add <path> <branch>` checks out the existing branch and fails with
      // BRANCH_CHECKED_OUT when that branch is already active in another worktree. Create a
      // new local branch at the same commit instead.
      const wtBranch = await GitService.allocateUniqueLocalBranchName(repoPath, `${branch}-wt`)
      args.push('-b', wtBranch, worktreePath, branch)
    } else {
      args.push(worktreePath, branch)
    }

    const runWorktreeAdd = async (): Promise<void> => {
      reportCreateWorktreeProgress(onProgress, {
        stage: 'create-worktree',
        message: 'Creating worktree...',
      })
      await git(args, repoPath)
    }

    try {
      await runWorktreeAdd()
    } catch (err) {
      const msg = friendlyGitError(err, 'Failed to create worktree')
      if (msg === 'BRANCH_CHECKED_OUT' && !force) {
        throw new Error(
          'That branch is already checked out in another work folder. Close the other workspace or switch branches there, then try again.',
        )
      }
      if (msg === 'WORKTREE_PATH_EXISTS' && force) {
        await GitService.pruneWorktrees(repoPath)
        if (existsSync(worktreePath)) {
          await GitService.removeExistingWorkspacePath(repoPath, worktreePath)
        }
        try {
          await runWorktreeAdd()
        } catch (err2) {
          throw new Error(friendlyGitError(err2, 'Failed to create worktree'))
        }
      } else {
        throw new Error(msg)
      }
    }

    // Fast-forward existing branches to match upstream
    if (!newBranch || branchExists) {
      reportCreateWorktreeProgress(onProgress, {
        stage: 'sync-branch',
        message: 'Fast-forwarding branch...',
      })
      await git(['pull', '--ff-only'], worktreePath).catch(() => {})
    }

    // Copy repo-local credential artifacts that are missing from the worktree.
    reportCreateWorktreeProgress(onProgress, {
      stage: 'copy-env-files',
      message: 'Copying credential files...',
    })
    await copyWorktreeCredentialArtifacts(repoPath, worktreePath, credentialRules)

    return worktreePath
  }

  static async createWorktreeFromPr(
    repoPath: string,
    name: string,
    prNumber: number,
    localBranch: string,
    force = false,
    onProgress?: CreateWorktreeProgressReporter,
    credentialRules?: WorktreeCredentialRule[],
    options: CreatePrWorktreeOptions = {},
  ): Promise<PrWorktreeResult> {
    const parsedPrNumber = Number(prNumber)
    if (!Number.isInteger(parsedPrNumber) || parsedPrNumber <= 0) {
      throw new Error('Invalid pull request number')
    }

    const requestedBranch = localBranch.trim()
    const branch = GitService.sanitizeBranchName(requestedBranch)
    if (!branch) throw new Error('Branch name is empty after sanitization')

    const parentDir = dirname(repoPath)
    const repoName = basename(repoPath)
    const safeWorktreeName = sanitizeWorktreeName(name)
    const worktreePath = resolve(parentDir, `${repoName}-ws-${safeWorktreeName}`)
    ensureWithinParent(parentDir, worktreePath)

    reportCreateWorktreeProgress(onProgress, {
      stage: 'prune-worktrees',
      message: 'Cleaning stale worktree references...',
    })
    await GitService.pruneWorktrees(repoPath)

    const hasOrigin = await GitService.hasRemote(repoPath, 'origin')
    if (!hasOrigin) {
      throw new Error('No origin remote found')
    }

    const headRefName = GitService.sanitizeBranchName((options.headRefName ?? '').trim())
    const pushRef = `refs/heads/${headRefName || branch}`
    let pushRemote = 'origin'
    const requestedHeadRemoteName = GitService.sanitizeRemoteName((options.headRemoteName ?? '').trim())
    const headRemoteUrl = (options.headRemoteUrl ?? '').trim()
    if (headRemoteUrl && requestedHeadRemoteName && requestedHeadRemoteName !== 'origin') {
      pushRemote = requestedHeadRemoteName
      if (await GitService.hasRemote(repoPath, pushRemote)) {
        await git(['remote', 'set-url', pushRemote, headRemoteUrl], repoPath)
      } else {
        await git(['remote', 'add', pushRemote, headRemoteUrl], repoPath)
      }
    }

    reportCreateWorktreeProgress(onProgress, {
      stage: 'fetch-origin',
      message: `Fetching PR #${parsedPrNumber}...`,
    })
    try {
      await git(['fetch', '--prune', 'origin'], repoPath).catch(() => {})
      await git(['fetch', 'origin', `+pull/${parsedPrNumber}/head:${branch}`], repoPath)
    } catch (err) {
      const msg = friendlyGitError(err, `Failed to fetch PR #${parsedPrNumber}`)
      if (msg.includes('couldn\'t find remote ref') || msg.includes('no such remote ref')) {
        throw new Error(`Pull request #${parsedPrNumber} not found`)
      }
      throw new Error(msg)
    }

    reportCreateWorktreeProgress(onProgress, {
      stage: 'prepare-worktree-dir',
      message: 'Preparing worktree directory...',
    })
    if (existsSync(worktreePath)) {
      if (!force) {
        throw new Error('WORKTREE_PATH_EXISTS')
      }
      await GitService.removeExistingWorkspacePath(repoPath, worktreePath)
    }

    reportCreateWorktreeProgress(onProgress, {
      stage: 'create-worktree',
      message: 'Creating worktree...',
    })
    let checkoutBranch = branch
    const runWorktreeAdd = async (): Promise<void> => {
      const args = ['worktree', 'add']
      if (force) args.push('--force')
      if (checkoutBranch === branch) {
        args.push(worktreePath, branch)
      } else {
        args.push('-b', checkoutBranch, worktreePath, branch)
      }
      await git(args, repoPath)
    }

    try {
      await runWorktreeAdd()
    } catch (err) {
      const msg = friendlyGitError(err, 'Failed to create worktree')
      if (msg === 'BRANCH_CHECKED_OUT' && !force && checkoutBranch === branch) {
        checkoutBranch = await GitService.allocateUniqueLocalBranchName(repoPath, `${branch}-wt`)
        try {
          await runWorktreeAdd()
        } catch (err2) {
          const msg2 = friendlyGitError(err2, 'Failed to create worktree')
          if (msg2 === 'BRANCH_CHECKED_OUT' && !force) {
            throw new Error(
              'That branch is already checked out in another work folder. Close the other workspace or switch branches there, then try again.',
            )
          }
          throw new Error(msg2)
        }
      } else if (msg === 'BRANCH_CHECKED_OUT' && !force) {
        throw new Error(
          'That branch is already checked out in another work folder. Close the other workspace or switch branches there, then try again.',
        )
      } else {
        throw new Error(msg)
      }
    }

    reportCreateWorktreeProgress(onProgress, {
      stage: 'sync-branch',
      message: 'Fast-forwarding branch...',
    })
    await git(['pull', '--ff-only'], worktreePath).catch(() => {})

    reportCreateWorktreeProgress(onProgress, {
      stage: 'copy-env-files',
      message: 'Copying credential files...',
    })
    await copyWorktreeCredentialArtifacts(repoPath, worktreePath, credentialRules)

    return { worktreePath, branch: checkoutBranch, pushRemote, pushRef }
  }

  static async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await git(['worktree', 'remove', '--force', worktreePath], repoPath)
    } catch (err) {
      throw new Error(friendlyGitError(err, 'Failed to remove worktree'))
    }
  }

  static async getTopLevel(cwd: string): Promise<string> {
    return git(['rev-parse', '--show-toplevel'], cwd)
  }

  /** Repo-root → cwd prefix (posix, no trailing slash), e.g. `apps/web` or `` at repo root. */
  static async getPathPrefixFromRepoRoot(cwd: string): Promise<string> {
    try {
      const out = await git(['rev-parse', '--show-prefix'], cwd)
      const raw = out.trim()
      if (!raw) return ''
      return raw.replace(/\/+$/, '').replace(/\\/g, '/')
    } catch {
      return ''
    }
  }

  static async getCurrentBranch(worktreePath: string): Promise<string> {
    if (!existsSync(worktreePath)) return ''
    try {
      return await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)
    } catch {
      return ''
    }
  }

  static async getHeadHash(worktreePath: string): Promise<string> {
    if (!existsSync(worktreePath)) return ''
    try {
      return await git(['rev-parse', 'HEAD'], worktreePath)
    } catch {
      return ''
    }
  }

  static async getStatus(worktreePath: string): Promise<FileStatus[]> {
    const output = await git(
      ['status', '--porcelain=v1', '-uall'],
      worktreePath
    )
    if (!output) return []

    const results: FileStatus[] = []

    /** Porcelain rename/copy lines use `ORIG -> DEST`; use worktree destination path. */
    const porcelainPath = (raw: string): string => {
      const arrow = ' -> '
      const i = raw.lastIndexOf(arrow)
      return i >= 0 ? raw.slice(i + arrow.length).trim() : raw
    }

    for (const line of output.split('\n')) {
      const indexStatus = line[0]
      const workStatus = line[1]
      const path = porcelainPath(line.slice(3))

      if (indexStatus === '?' && workStatus === '?') {
        results.push({ path, status: 'untracked', staged: false })
        continue
      }

      // Staged entry (index has a real status)
      if (indexStatus !== ' ' && indexStatus !== '?') {
        const status: FileStatus['status'] =
          indexStatus === 'A' ? 'added' :
          indexStatus === 'D' ? 'deleted' :
          indexStatus === 'R' ? 'renamed' : 'modified'
        results.push({ path, status, staged: true })
      }

      // Unstaged entry (worktree has a real status)
      if (workStatus !== ' ' && workStatus !== '?') {
        const status: FileStatus['status'] =
          workStatus === 'D' ? 'deleted' : 'modified'
        results.push({ path, status, staged: false })
      }
    }

    return results
  }

  static async getDiff(worktreePath: string, staged: boolean): Promise<FileDiff[]> {
    const args = ['diff']
    if (staged) args.push('--staged')
    args.push('--unified=3')

    const output = await git(args, worktreePath)
    if (!output) return []

    // Split by file boundaries
    const files: FileDiff[] = []
    const parts = output.split(/^diff --git /m).filter(Boolean)

    for (const part of parts) {
      const firstLine = part.split('\n')[0]
      // Extract b/path from "a/path b/path"
      const match = firstLine.match(/b\/(.+)$/)
      if (match) {
        files.push({
          path: match[1],
          hunks: 'diff --git ' + part,
        })
      }
    }

    return files
  }

  static async getWorkingTreeDiff(worktreePath: string): Promise<string> {
    try {
      return await git(['diff', '--find-renames', '--unified=3', 'HEAD', '--'], worktreePath)
    } catch {
      return ''
    }
  }

  static async getFileDiff(worktreePath: string, filePath: string): Promise<string> {
    try {
      // One coherent diff vs HEAD — matches what AnnotationService uses for validation.
      // Plain `git diff` + `--staged` fallback can disagree when a file has both staged and
      // unstaged edits.
      const vsHead = await git(['diff', 'HEAD', '--', filePath], worktreePath)
      if (vsHead) return vsHead
      // Untracked paths often have no `HEAD` blob; try index/worktree slices as a fallback.
      const unstaged = await git(['diff', '--', filePath], worktreePath)
      if (unstaged) return unstaged
      const staged = await git(['diff', '--staged', '--', filePath], worktreePath)
      if (staged) return staged

      const absolutePath = isAbsolute(filePath) ? filePath : join(worktreePath, filePath)
      try {
        const stats = await lstat(absolutePath)
        if (stats.isSymbolicLink()) {
          const target = await readlink(absolutePath)
          return buildSyntheticSymlinkPatch(filePath, target)
        }
        return await git(['diff', '--no-index', '/dev/null', filePath], worktreePath)
      } catch {
        return ''
      }
    } catch {
      return ''
    }
  }

  static async getBranches(repoPath: string): Promise<string[]> {
    const [localOut, remoteOut] = await Promise.all([
      git(['branch', '--list', '--format=%(refname:short)'], repoPath),
      git(['branch', '-r', '--format=%(refname:short)'], repoPath).catch(() => ''),
    ])
    const seen = new Set<string>()
    const branches: string[] = []
    // Add local branches first
    for (const name of localOut.split('\n').filter(Boolean)) {
      seen.add(name)
      branches.push(name)
    }
    // Add remote branches, stripping remote prefix and deduplicating
    for (const raw of remoteOut.split('\n').filter(Boolean)) {
      if (raw.endsWith('/HEAD')) continue
      // "origin/feature-x" → "feature-x", "origin/feat/sub" → "feat/sub"
      const slash = raw.indexOf('/')
      const name = slash >= 0 ? raw.slice(slash + 1) : raw
      if (!seen.has(name)) {
        seen.add(name)
        branches.push(name)
      }
    }
    return branches
  }

  static async stage(worktreePath: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await git(['add', '--', ...paths], worktreePath)
  }

  /** Stage every change in the worktree including deletions (`git add -A`). */
  static async stageAll(worktreePath: string): Promise<void> {
    await git(['add', '-A'], worktreePath)
  }

  static async unstage(worktreePath: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await git(['reset', 'HEAD', '--', ...paths], worktreePath)
  }

  static async discard(worktreePath: string, paths: string[], untracked: string[]): Promise<void> {
    if (paths.length > 0) {
      await git(['checkout', '--', ...paths], worktreePath)
    }
    if (untracked.length > 0) {
      await git(['clean', '-f', '--', ...untracked], worktreePath)
    }
  }

  static async applyHunkAction(worktreePath: string, request: GitHunkActionRequest): Promise<void> {
    if (request.status !== 'modified') {
      throw new Error('Partial Keep/Undo currently only supports modified tracked files')
    }
    const singleHunkPatch = buildSingleHunkGitPatch(request.patch, request.hunkIndex)
    if (request.action === 'keep') {
      await applyGitPatch(
        worktreePath,
        singleHunkPatch,
        ['--cached', '--recount', '--whitespace=nowarn'],
        `Failed to stage selected hunk in ${request.filePath}`,
      )
      return
    }
    await applyGitPatch(
      worktreePath,
      singleHunkPatch,
      ['-R', '--recount', '--whitespace=nowarn'],
      `Failed to undo selected hunk in ${request.filePath}`,
    )
  }

  static async commit(worktreePath: string, message: string): Promise<void> {
    await git(['commit', '-m', message], worktreePath)
  }

  /**
   * Fetch `<remote> <ref>` then `git rebase FETCH_HEAD`. On conflict, throws
   * a `RebaseConflictError` with the conflicted file list and leaves the rebase
   * mid-flight so a coding agent (or the user) can resolve it. Other failures
   * are surfaced via `friendlyGitError`.
   */
  static async fetchAndRebase(worktreePath: string, remote: string, ref: string): Promise<void> {
    const cleanRemote = GitService.sanitizeRemoteName(remote || 'origin') || 'origin'
    const cleanRef = GitService.sanitizeBranchName(ref)
    if (!cleanRef) throw new Error('Remote ref is required for fetch + rebase')
    try {
      await git(['fetch', cleanRemote, cleanRef], worktreePath)
    } catch (err) {
      throw new Error(friendlyGitError(err, `Failed to fetch ${cleanRemote}/${cleanRef}`))
    }
    try {
      await git(['rebase', 'FETCH_HEAD'], worktreePath)
    } catch (err) {
      const stderr =
        typeof err === 'object' && err !== null && 'stderr' in err
          ? String((err as { stderr?: unknown }).stderr ?? '')
          : ''
      const stdout =
        typeof err === 'object' && err !== null && 'stdout' in err
          ? String((err as { stdout?: unknown }).stdout ?? '')
          : ''
      const blob = `${stderr}\n${stdout}`
      const isConflict =
        /CONFLICT \(/.test(blob) ||
        /could not apply/i.test(blob) ||
        /Resolve all conflicts manually/i.test(blob)
      if (isConflict) {
        const files = await GitService.listRebaseConflicts(worktreePath).catch(() => [] as string[])
        throw new RebaseConflictError(files)
      }
      throw new Error(friendlyGitError(err, 'Rebase failed'))
    }
  }

  /**
   * Parses `git status --porcelain=v1 -z` for two-character conflict codes
   * (`UU AA DD UA AU UD DU`) and returns the affected paths.
   */
  static async listRebaseConflicts(worktreePath: string): Promise<string[]> {
    let raw = ''
    try {
      raw = await git(['status', '--porcelain=v1', '-z'], worktreePath)
    } catch {
      return []
    }
    if (!raw) return []
    const CONFLICT_CODES = new Set(['UU', 'AA', 'DD', 'UA', 'AU', 'UD', 'DU'])
    const out: string[] = []
    const entries = raw.split('\0')
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (!entry || entry.length < 4) continue
      const code = entry.slice(0, 2)
      // `R `/`C ` rename/copy entries occupy two null-terminated fields; skip the second.
      if (code[0] === 'R' || code[1] === 'R' || code[0] === 'C' || code[1] === 'C') {
        i += 1
        continue
      }
      if (CONFLICT_CODES.has(code)) {
        const path = entry.slice(3)
        if (path) out.push(path)
      }
    }
    return out
  }

  /** True when HEAD is ahead of `<remote>/<ref>` by at least one commit. */
  static async isAheadOfRemote(worktreePath: string, remote: string, ref: string): Promise<boolean> {
    const cleanRemote = GitService.sanitizeRemoteName(remote || 'origin') || 'origin'
    const cleanRef = GitService.sanitizeBranchName(ref)
    if (!cleanRef) return false
    try {
      const out = await git(['rev-list', '--count', `${cleanRemote}/${cleanRef}..HEAD`], worktreePath)
      const n = Number.parseInt(out.trim(), 10)
      return Number.isFinite(n) && n > 0
    } catch {
      return false
    }
  }

  static async pushCurrentBranch(worktreePath: string): Promise<void> {
    try {
      await git(['push', '--set-upstream', 'origin', 'HEAD'], worktreePath)
    } catch (err) {
      throw new Error(friendlyGitError(err, 'Failed to push current branch'))
    }
  }

  static async pushToPrHead(worktreePath: string, remote: string, headRefName: string): Promise<void> {
    const cleanRemote = GitService.sanitizeRemoteName(remote || 'origin') || 'origin'
    const cleanHead = GitService.sanitizeBranchName(headRefName)
    if (!cleanHead) throw new Error('PR head branch is required')
    try {
      await git(['push', cleanRemote, `HEAD:refs/heads/${cleanHead}`], worktreePath)
    } catch (err) {
      throw new Error(friendlyGitError(err, 'Failed to push PR head branch'))
    }
  }

  /**
   * Switch to `branch` inside `worktreePath`. When `createNew` is set, creates
   * the branch at current HEAD (`git checkout -b`), carrying any uncommitted
   * working-tree changes along — this is what powers the "branch this work"
   * flow for users who have edits on their default branch.
   */
  static async checkoutBranch(
    worktreePath: string,
    branch: string,
    createNew = false,
  ): Promise<void> {
    const trimmed = branch.trim()
    if (!trimmed) throw new Error('Branch name is required.')
    const args = createNew ? ['checkout', '-b', trimmed] : ['checkout', trimmed]
    try {
      await git(args, worktreePath)
    } catch (err) {
      throw new Error(friendlyGitError(err, `Failed to checkout ${trimmed}`))
    }
  }

  static async showFileAtHead(worktreePath: string, filePath: string): Promise<string | null> {
    try {
      return await git(['show', 'HEAD:' + filePath], worktreePath)
    } catch {
      return null // File is new/untracked
    }
  }

  static async getLog(worktreePath: string, maxCount = 80): Promise<GitLogEntry[]> {
    // Use git's %x00 escape so no literal null bytes appear in the argument string
    // (Node.js execFile rejects strings containing \x00)
    const format = '%H%x00%P%x00%s%x00%D%x00%an%x00%ar'
    const output = await git(
      ['log', '--all', '--topo-order', `--format=${format}`, '-n', String(maxCount)],
      worktreePath,
    )
    if (!output) return []

    const SEP = '\x00' // git outputs actual null bytes
    const entries: GitLogEntry[] = []
    for (const line of output.split('\n')) {
      if (!line) continue
      const parts = line.split(SEP)
      if (parts.length < 6) continue
      entries.push({
        hash: parts[0],
        parents: parts[1] ? parts[1].split(' ') : [],
        message: parts[2],
        refs: parts[3] ? parts[3].split(', ').map((r) => r.trim()).filter(Boolean) : [],
        author: parts[4],
        relativeDate: parts[5],
      })
    }
    return entries
  }

  static async getRemoteHeadHash(repoPath: string, branch: string): Promise<string> {
    const output = await git(['ls-remote', '--heads', 'origin', branch], repoPath)
    if (!output) return ''
    return output.split(/\s/)[0] || ''
  }

  static async syncWorktree(
    worktreePath: string,
    defaultBranch: string,
    onProgress?: (progress: SyncProgress) => void,
  ): Promise<SyncResult> {
    const report = (stage: SyncProgress['stage'], message: string) =>
      onProgress?.({ worktreePath, stage, message })

    let didStash = false
    try {
      // Check if dirty
      report('stash', 'Checking for uncommitted changes...')
      const status = await git(['status', '--porcelain'], worktreePath)
      if (status.trim()) {
        await git(['stash', 'push', '-m', 'constellagent-sync'], worktreePath)
        didStash = true
      }

      // Fetch
      report('fetch', 'Fetching from origin...')
      await git(['fetch', 'origin'], worktreePath)

      // Rebase
      report('rebase', `Rebasing onto ${defaultBranch}...`)
      try {
        await git(['rebase', defaultBranch], worktreePath)
      } catch (rebaseErr) {
        // Abort rebase and restore stash
        await git(['rebase', '--abort'], worktreePath).catch(() => {})
        if (didStash) {
          await git(['stash', 'pop'], worktreePath).catch(() => {})
        }
        report('error', 'Rebase failed — aborted and restored')
        return {
          worktreePath,
          success: false,
          error: friendlyGitError(rebaseErr, 'Rebase failed'),
        }
      }

      // Stash pop
      if (didStash) {
        report('stash-pop', 'Restoring stashed changes...')
        try {
          await git(['stash', 'pop'], worktreePath)
        } catch {
          report('error', 'Stash pop had conflicts')
          return {
            worktreePath,
            success: true,
            stashPopConflict: true,
          }
        }
      }

      report('done', 'Sync complete')
      return { worktreePath, success: true }
    } catch (err) {
      report('error', friendlyGitError(err, 'Sync failed'))
      return {
        worktreePath,
        success: false,
        error: friendlyGitError(err, 'Sync failed'),
      }
    }
  }

  static async syncAllWorktrees(
    repoPath: string,
    onProgress?: (progress: SyncProgress) => void,
  ): Promise<SyncResult[]> {
    const defaultBranch = await GitService.getDefaultBranch(repoPath)
    const worktrees = await GitService.listWorktrees(repoPath)

    // Filter out bare worktrees and the one on the default branch
    const defaultBranchShort = defaultBranch.replace(/^origin\//, '')
    const toSync = worktrees.filter(
      (wt) => !wt.isBare && wt.branch !== defaultBranchShort,
    )

    const results: SyncResult[] = []
    for (const wt of toSync) {
      const result = await GitService.syncWorktree(wt.path, defaultBranch, onProgress)
      results.push(result)
    }
    return results
  }

  static async getCommitDiff(worktreePath: string, hash: string): Promise<string> {
    try {
      return await git(['show', '--format=', '--patch', hash], worktreePath)
    } catch {
      // Object may not be available locally (e.g. remote-only ref in a worktree).
      // Try fetching the object first, then retry.
      try {
        await git(['fetch', '--depth=1', 'origin', hash], worktreePath)
        return await git(['show', '--format=', '--patch', hash], worktreePath)
      } catch {
        return '' // Object is unreachable — return empty diff
      }
    }
  }

  /** Remote hash pointed to by origin HEAD (default branch tip). No fetch. */
  static async getRemoteHead(repoPath: string): Promise<string | null> {
    const hasOrigin = await this.hasRemote(repoPath, 'origin')
    if (!hasOrigin) return null
    try {
      const output = await spawnAndCapture(
        'git',
        ['ls-remote', 'origin', 'HEAD'],
        repoPath,
        1024 * 1024,
      )
      const line = output.trim().split('\n')[0]
      if (!line) return null
      const hash = line.split('\t')[0]?.trim()
      return hash || null
    } catch {
      return null
    }
  }

  /** Best-effort fetch so local origin/* matches remote before rebase. */
  static async fetchOrigin(repoPath: string): Promise<void> {
    const hasOrigin = await this.hasRemote(repoPath, 'origin')
    if (!hasOrigin) return
    await git(['fetch', '--prune', 'origin'], repoPath).catch(() => {})
  }

  // ── Spotlight helpers ────────────────────────────────────────────────
  // Conductor-style "Spotlight testing": stage the worktree, record a tree on a
  // private ref (`refs/spotlight/<wsId>`), and apply that tree into the repo
  // root via `read-tree -u -m`. The 2-way merge form preserves untracked root
  // files (node_modules, .next, build caches) so dev servers keep running.

  /**
   * `git add -A` in the worktree, then `write-tree` → `commit-tree` →
   * `update-ref refs/spotlight/<wsId>`. Returns the new commit SHA. The
   * workspace's working branch is never touched.
   */
  static async commitToSpotlightRef(worktreePath: string, wsId: string): Promise<string> {
    const refName = GitService.spotlightRefName(wsId)
    // Stage everything (including deletions). Use a dedicated index file so
    // the worktree's user-visible index stays untouched if anything fails
    // mid-flight — see `GIT_INDEX_FILE` env override below.
    const indexPath = join(tmpdir(), `constellagent-spotlight-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    try {
      // Initialize the temp index by copying the worktree's current index so
      // file modes / rename detection inherit existing state.
      const wtIndex = join(worktreePath, '.git', 'index')
      if (existsSync(wtIndex)) {
        await readFile(wtIndex).then((buf) => writeFile(indexPath, buf))
      }
      await spawnAndCaptureWithEnv('git', ['add', '-A'], worktreePath, { GIT_INDEX_FILE: indexPath })
      const tree = (await spawnAndCaptureWithEnv('git', ['write-tree'], worktreePath, { GIT_INDEX_FILE: indexPath })).trim()
      if (!tree) throw new Error('git write-tree returned empty output')

      // Reuse the prior spotlight commit as parent (if any) so the recovery ref
      // forms a navigable chain for `git log refs/spotlight/<wsId>`.
      let parentSha: string | null = null
      try {
        parentSha = (await git(['rev-parse', '--verify', refName], worktreePath)).trim() || null
      } catch {
        parentSha = null
      }

      const message = `spotlight: ${new Date().toISOString()}`
      const commitArgs = ['commit-tree', tree, '-m', message]
      if (parentSha) commitArgs.push('-p', parentSha)
      const commit = (await spawnAndCaptureWithEnv('git', commitArgs, worktreePath, {
        // Identity is required for `commit-tree`; use a deterministic one so
        // these checkpoints are easy to spot in reflog.
        GIT_AUTHOR_NAME: 'Constellagent Spotlight',
        GIT_AUTHOR_EMAIL: 'spotlight@constellagent',
        GIT_COMMITTER_NAME: 'Constellagent Spotlight',
        GIT_COMMITTER_EMAIL: 'spotlight@constellagent',
      })).trim()
      if (!commit) throw new Error('git commit-tree returned empty output')

      await git(['update-ref', refName, commit, parentSha ?? ''].filter(Boolean) as string[], worktreePath)
      return commit
    } finally {
      await rm(indexPath, { force: true }).catch(() => {})
    }
  }

  /**
   * `git -C <rootPath> read-tree -u -m <commitSha>` — atomically updates the
   * root's index + working tree to match the commit's tree. Untracked files at
   * root (build caches) are preserved by the 2-way merge semantics.
   *
   * Falls back to `archive | tar -x` when read-tree refuses to overwrite
   * locally-modified tracked files — this is a "Spotlight wins" sync, so the
   * fallback is the contract, not an emergency hatch.
   */
  static async readTreeInto(rootPath: string, commitSha: string): Promise<void> {
    try {
      await git(['read-tree', '-u', '-m', commitSha], rootPath)
      // `read-tree -m` updates the index; also need to checkout to update the
      // working tree files that are in the new tree.
      await git(['checkout-index', '-a', '-f'], rootPath)
    } catch {
      // Fallback: `archive | tar -x` — overwrites any locally-modified tracked
      // files at root, which matches the one-way-sync contract.
      await GitService.applyTreeViaArchive(rootPath, commitSha)
    }
  }

  /**
   * Stream `git archive` into `tar -x` so submodule pointer files transfer
   * correctly. Used both as a fallback for `read-tree` and as the primary path
   * when the worktree has submodules.
   */
  static async applyTreeViaArchive(rootPath: string, commitSha: string): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const archive = spawn('git', ['archive', '--format=tar', commitSha], {
        cwd: rootPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const tar = spawn('tar', ['-x', '-C', rootPath], {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      })
      let settled = false
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        try { archive.kill() } catch {}
        try { tar.kill() } catch {}
        rejectPromise(err)
      }
      archive.on('error', fail)
      tar.on('error', fail)
      archive.stdout?.pipe(tar.stdin!)
      tar.on('close', (code) => {
        if (settled) return
        if (code === 0) {
          settled = true
          resolvePromise()
        } else {
          fail(new Error(`tar -x exited with code ${code ?? 'unknown'}`))
        }
      })
    })
  }

  /** `git update-ref -d refs/spotlight/<wsId>` — cleans up on workspace delete. */
  static async deleteSpotlightRef(repoPath: string, wsId: string): Promise<void> {
    const refName = GitService.spotlightRefName(wsId)
    await git(['update-ref', '-d', refName], repoPath).catch(() => {})
  }

  /**
   * Snapshot root state before Spotlight engages: HEAD ref + a stash of any
   * uncommitted work (`--keep-index --include-untracked`). The stash sha is
   * returned so `restoreSpotlightSnapshot` can replay it on disable.
   */
  static async snapshotForSpotlight(rootPath: string): Promise<SpotlightRootSnapshot> {
    const head = (await git(['rev-parse', 'HEAD'], rootPath)).trim()
    // Save uncommitted edits (tracked + untracked) so we can restore exactly
    // what the user had open before Spotlight took over root.
    let stashSha: string | null = null
    try {
      const status = (await git(['status', '--porcelain=v1', '-z'], rootPath)).trim()
      if (status) {
        // `stash create` builds a stash commit without pushing it onto the
        // stash stack. Captures tracked-file edits only — untracked files at
        // root (node_modules, build caches) are *not* stashed and *not*
        // removed below, so they survive Spotlight engaging.
        const sha = (await git(['stash', 'create', 'constellagent-spotlight-pre'], rootPath)).trim()
        if (sha) stashSha = sha
        // Reset tracked working-tree changes only. We deliberately do NOT
        // run `git clean -fd` — that would nuke the untracked build caches
        // Spotlight is contractually obligated to preserve.
        await git(['reset', '--hard', 'HEAD'], rootPath)
      }
    } catch {
      stashSha = null
    }
    return { head, stashSha }
  }

  /**
   * Reverse `snapshotForSpotlight`: hard-reset root to the saved HEAD, then
   * replay the stash (if any) via `stash apply <sha>`. Untracked-at-root files
   * (build caches) are not touched.
   */
  static async restoreSpotlightSnapshot(rootPath: string, snapshot: SpotlightRootSnapshot): Promise<void> {
    await git(['reset', '--hard', snapshot.head], rootPath)
    if (snapshot.stashSha) {
      try {
        await git(['stash', 'apply', '--index', snapshot.stashSha], rootPath)
      } catch {
        // `--index` can fail when the stash also touched the index; fall back
        // to a plain apply (working-tree-only) before giving up silently.
        await git(['stash', 'apply', snapshot.stashSha], rootPath).catch(() => {})
      }
    }
  }

  /** True when `.git/MERGE_HEAD` or `.git/rebase-merge/` exists at `path`. */
  static async hasRebaseOrMergeInProgress(path: string): Promise<boolean> {
    try {
      const gitDir = (await git(['rev-parse', '--git-dir'], path)).trim()
      const abs = isAbsolute(gitDir) ? gitDir : join(path, gitDir)
      return (
        existsSync(join(abs, 'MERGE_HEAD')) ||
        existsSync(join(abs, 'rebase-merge')) ||
        existsSync(join(abs, 'rebase-apply')) ||
        existsSync(join(abs, 'CHERRY_PICK_HEAD'))
      )
    } catch {
      return false
    }
  }

  /** True when a `.gitmodules` file exists at the worktree root. */
  static async hasSubmodules(worktreePath: string): Promise<boolean> {
    return existsSync(join(worktreePath, '.gitmodules'))
  }

  private static spotlightRefName(wsId: string): string {
    // Avoid slashes/odd chars in the ref name; git refs forbid `..`, `~`, etc.
    const safe = wsId.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 200) || 'unknown'
    return `refs/spotlight/${safe}`
  }

  /**
   * Linked worktrees live at a different directory than the primary checkout.
   * Used to pin a Graphite "UI trunk" branch for secondary worktrees.
   */
  static async isSecondaryWorktreeRoot(repoPath: string, workspaceRoot: string): Promise<boolean> {
    try {
      if (!existsSync(repoPath) || !existsSync(workspaceRoot)) return false
      const primary = await realpath(repoPath)
      const wt = await realpath(workspaceRoot)
      return primary !== wt
    } catch {
      return false
    }
  }
}
