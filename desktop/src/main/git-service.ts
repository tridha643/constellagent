import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { lstat, readFile, readlink, readdir, realpath, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { promisify } from 'util'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import type { CreateWorktreeProgress } from '../shared/workspace-creation'
import type { GitLogEntry, WorktreeInfo } from '../shared/git-types'
import type { SyncProgress, SyncResult } from '../shared/sync-types'
import type { WorktreeCredentialRule } from '../shared/worktree-credentials'
import type { GitHunkActionRequest } from '../shared/git-hunk-action-types'
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
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout.trimEnd()
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

    try {
      reportCreateWorktreeProgress(onProgress, {
        stage: 'create-worktree',
        message: 'Creating worktree...',
      })
      await git(args, repoPath)
    } catch (err) {
      const msg = friendlyGitError(err, 'Failed to create worktree')
      if (msg === 'BRANCH_CHECKED_OUT' && !force) {
        throw new Error(
          'That branch is already checked out in another work folder. Close the other workspace or switch branches there, then try again.',
        )
      }
      throw new Error(msg)
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

    return { worktreePath, branch: checkoutBranch }
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

  static async pushCurrentBranch(worktreePath: string): Promise<void> {
    try {
      await git(['push', '--set-upstream', 'origin', 'HEAD'], worktreePath)
    } catch (err) {
      throw new Error(friendlyGitError(err, 'Failed to push current branch'))
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
      const { stdout } = await execFileAsync('git', ['ls-remote', 'origin', 'HEAD'], {
        cwd: repoPath,
        maxBuffer: 1024 * 1024,
      })
      const line = stdout.trim().split('\n')[0]
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
