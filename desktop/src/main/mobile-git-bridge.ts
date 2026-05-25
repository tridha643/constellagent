// Codex-shaped git/* RPC handlers used by the iOS companion (GitActionsService).
// These bypass the dot-notation mobile protocol router and delegate to GitService.

import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { GitService } from './git-service'
import { extractManagedWorktreeToken, registerMobileWorkspaceForPath } from './mobile-workspace-registry'

const execFileAsync = promisify(execFile)

export class MobileGitBridgeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function requireCwd(params: Record<string, unknown>): string {
  const cwd = typeof params.cwd === 'string' ? params.cwd.trim() : ''
  if (!cwd) {
    throw new MobileGitBridgeError('missing_working_directory', 'The selected local folder is not available on this device.')
  }
  return cwd
}

function managedWorktreeToken(): string {
  return randomBytes(4).toString('hex')
}

async function resolveRepoRoot(cwd: string): Promise<string> {
  const repoPath = await GitService.getProjectRepoAnchor(cwd)
  if (!repoPath) {
    throw new MobileGitBridgeError('missing_local_repo', 'Run `constellagent up` from an existing local directory first.')
  }
  return repoPath
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

async function gitBranchesWithStatus(cwd: string): Promise<Record<string, unknown>> {
  const repoPath = await resolveRepoRoot(cwd)
  const [branches, currentBranch, defaultBranch, status, worktrees] = await Promise.all([
    GitService.getBranches(repoPath),
    GitService.getCurrentBranch(cwd).catch(() => ''),
    GitService.getDefaultBranch(repoPath).catch(() => 'main'),
    GitService.getStatus(cwd).catch(() => []),
    GitService.listWorktrees(repoPath).catch(() => []),
  ])

  const worktreePathByBranch: Record<string, string> = {}
  const branchesCheckedOutElsewhere = new Set<string>()
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')

  for (const worktree of worktrees) {
    if (!worktree.branch || !worktree.path) continue
    worktreePathByBranch[worktree.branch] = worktree.path
    const normalizedPath = worktree.path.replace(/\\/g, '/').replace(/\/+$/, '')
    if (normalizedPath !== normalizedCwd) {
      branchesCheckedOutElsewhere.add(worktree.branch)
    }
  }

  return {
    branches,
    branchesCheckedOutElsewhere: Array.from(branchesCheckedOutElsewhere),
    worktreePathByBranch,
    localCheckoutPath: repoPath,
    current: currentBranch,
    default: defaultBranch,
    status: {
      branch: currentBranch,
      files: status,
    },
  }
}

async function gitCreateManagedWorktree(
  cwd: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const baseBranch = typeof params.baseBranch === 'string' ? params.baseBranch.trim() : ''
  if (!baseBranch) {
    throw new MobileGitBridgeError('missing_base_branch', 'Base branch is required.')
  }

  const repoPath = await resolveRepoRoot(cwd)
  const token = managedWorktreeToken()
  const worktreePath = join(repoPath, '.constellagent', 'worktrees', token)
  await mkdir(join(repoPath, '.constellagent', 'worktrees'), { recursive: true })

  let alreadyExisted = false
  try {
    await access(worktreePath)
    alreadyExisted = true
  } catch {
    alreadyExisted = false
  }

  if (!alreadyExisted) {
    try {
      await runGit(['worktree', 'add', '--detach', worktreePath, baseBranch], repoPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new MobileGitBridgeError('branch_not_found', message || `Could not create managed worktree for ${baseBranch}.`)
    }
  }

  await registerMobileWorkspaceForPath({
    worktreePath,
    branch: baseBranch,
    name: `[${token}]`,
  })

  return {
    worktreePath,
    alreadyExisted,
    baseBranch,
    headMode: 'detached',
    transferredChanges: false,
  }
}

async function gitCreateWorktree(
  cwd: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const name = typeof params.name === 'string' ? params.name.trim() : ''
  const baseBranch = typeof params.baseBranch === 'string' ? params.baseBranch.trim() : ''
  if (!name) throw new MobileGitBridgeError('missing_branch_name', 'Branch name is required.')
  if (!baseBranch) throw new MobileGitBridgeError('missing_base_branch', 'Base branch is required.')

  const repoPath = await resolveRepoRoot(cwd)
  const branch = GitService.sanitizeBranchName(name)
  const worktreePath = await GitService.createWorktree(
    repoPath,
    name,
    branch,
    true,
    baseBranch,
    false,
  )
  const createdBranch = await GitService.getCurrentBranch(worktreePath).catch(() => branch)

  await registerMobileWorkspaceForPath({
    worktreePath,
    branch: createdBranch,
    name,
  })

  return {
    branch: createdBranch,
    worktreePath,
    alreadyExisted: false,
  }
}

export function isMobileGitBridgeMethod(method: string): boolean {
  return method.startsWith('git/') && method.includes('/')
}

export async function handleMobileGitBridgeMethod(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const cwd = requireCwd(params)

  switch (method) {
    case 'git/branchesWithStatus':
      return await gitBranchesWithStatus(cwd)
    case 'git/createManagedWorktree':
      return await gitCreateManagedWorktree(cwd, params)
    case 'git/createWorktree':
      return await gitCreateWorktree(cwd, params)
    default:
      throw new MobileGitBridgeError('method_not_found', `Unsupported git bridge method: ${method}`)
  }
}

export const __testing = {
  extractManagedWorktreeToken,
  managedWorktreeToken,
}
