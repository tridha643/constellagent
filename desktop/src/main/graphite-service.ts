import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { basename, dirname, join, resolve } from 'path'
import { GRAPHITE_DEFAULT_BRANCH_ONLY_ERROR, GRAPHITE_SINGLE_ACTION_ERROR } from '../shared/graphite-types'
import type {
  GraphiteBranchInfo,
  GraphiteCreateBranchOption,
  GraphiteCreateOptions,
  GraphiteStackAction,
  GraphiteStackActionResult,
  GraphiteStackInfo,
} from '../shared/graphite-types'
import type { WorktreeCredentialRule } from '../shared/worktree-credentials'
import { copyWorktreeCredentialArtifacts } from './worktree-credential-copy'
import { GitService } from './git-service'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout.trimEnd()
}

async function graphite(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('gt', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  })
  return stdout.trimEnd()
}

function graphiteErrorMessage(err: unknown, fallback: string): string {
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

  const lower = message.toLowerCase()
  if (lower.includes('command not found') || lower.includes('spawn gt enoent')) {
    return 'Graphite CLI is not installed.'
  }
  if (lower.includes('not initialized') || lower.includes('run gt init')) {
    return 'Graphite is not initialized for this repository.'
  }
  if (lower.includes('not authenticated') || lower.includes('log in')) {
    return 'Graphite CLI is not authenticated.'
  }
  if (lower.includes('nothing to submit')) {
    return 'There is nothing new to submit in this stack.'
  }

  return message
    .split('\n')
    .map((line) => line.replace(/^error:\s*/i, '').trim())
    .filter(Boolean)[0] || fallback
}

/**
 * Resolve the common .git directory for a repo or worktree.
 * For worktrees this returns the main repo's .git dir where
 * shared metadata (like .graphite_metadata.db) lives.
 */
async function resolveGitCommonDir(repoPath: string): Promise<string> {
  const rel = await git(['rev-parse', '--git-common-dir'], repoPath)
  return resolve(repoPath, rel)
}

/**
 * Parse graphite branch metadata from the SQLite metadata DB
 * (.git/.graphite_metadata.db) used by Graphite CLI >= ~1.0.
 */
async function parseGraphiteSqliteMetadata(gitCommonDir: string): Promise<Map<string, string>> {
  const dbPath = join(gitCommonDir, '.graphite_metadata.db')
  if (!existsSync(dbPath)) return new Map()

  const map = new Map<string, string>()
  try {
    const { stdout } = await execFileAsync('sqlite3', [
      dbPath,
      '-separator', '\t',
      'SELECT branch_name, parent_branch_name FROM branch_metadata WHERE parent_branch_name IS NOT NULL AND parent_branch_name != "";',
    ], { maxBuffer: 1024 * 1024 })
    for (const line of stdout.trimEnd().split('\n')) {
      if (!line) continue
      const [branch, parent] = line.split('\t')
      if (branch && parent) map.set(branch, parent)
    }
  } catch {
    // sqlite3 not available or DB unreadable — fall through
  }
  return map
}

/**
 * Parse graphite branch metadata from refs/branch-metadata/ (older CLI).
 * Each ref is a JSON blob with a parentBranchName field.
 */
async function parseGraphiteRefMetadata(repoPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const refsOutput = await git(
      ['for-each-ref', '--format=%(refname)', 'refs/branch-metadata/'],
      repoPath,
    )
    for (const refName of refsOutput.split('\n')) {
      if (!refName) continue
      const branchName = refName.replace('refs/branch-metadata/', '')
      try {
        const blob = await git(['cat-file', '-p', refName], repoPath)
        const meta = JSON.parse(blob)
        const parent = meta.parentBranchName ?? meta.parent
        if (typeof parent === 'string' && parent) {
          map.set(branchName, parent)
        }
      } catch {
        // Unparseable ref — skip
      }
    }
  } catch {
    // No refs/branch-metadata/ — return empty
  }
  return map
}

/**
 * Parse graphite branch metadata from git config (legacy / Constellagent cloneStack).
 */
async function parseGraphiteConfigMetadata(repoPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const output = await git(['config', '--get-regexp', '^graphite\\.branch\\.'], repoPath)
    for (const line of output.split('\n')) {
      if (!line) continue
      const match = line.match(/^graphite\.branch\.(.+)\.parent\s+(.+)$/)
      if (match) {
        map.set(match[1], match[2])
      }
    }
  } catch {
    // No graphite config entries
  }
  return map
}

/**
 * Collect graphite parent metadata from all known sources.
 * Priority: SQLite DB (current CLI) > refs (older CLI) > git config (cloneStack fallback).
 * Later sources only fill in branches not already present.
 */
async function parseGraphiteMetadata(repoPath: string): Promise<Map<string, string>> {
  let gitCommonDir: string
  try {
    gitCommonDir = await resolveGitCommonDir(repoPath)
  } catch {
    return new Map()
  }

  const map = await parseGraphiteSqliteMetadata(gitCommonDir)
  if (map.size > 0) return map

  const refMap = await parseGraphiteRefMetadata(repoPath)
  if (refMap.size > 0) return refMap

  return parseGraphiteConfigMetadata(repoPath)
}

async function writeGraphiteMetadata(
  repoPath: string,
  entries: { name: string; parent: string }[],
): Promise<void> {
  if (entries.length === 0) return

  let wroteToDb = false
  try {
    const gitCommonDir = await resolveGitCommonDir(repoPath)
    const dbPath = join(gitCommonDir, '.graphite_metadata.db')
    if (existsSync(dbPath)) {
      await execFileAsync('sqlite3', [
        dbPath,
        'CREATE TABLE IF NOT EXISTS branch_metadata (branch_name TEXT PRIMARY KEY, parent_branch_name TEXT);',
      ]).catch(() => {})
      for (const entry of entries) {
        await execFileAsync('sqlite3', [
          dbPath,
          `INSERT OR REPLACE INTO branch_metadata (branch_name, parent_branch_name) VALUES ('${entry.name.replace(/'/g, "''")}', '${entry.parent.replace(/'/g, "''")}');`,
        ]).catch(() => {})
      }
      wroteToDb = true
    }
  } catch {
    // DB write failed — fall through to git config
  }

  if (!wroteToDb) {
    for (const entry of entries) {
      await git(
        ['config', `graphite.branch.${entry.name}.parent`, entry.parent],
        repoPath,
      ).catch(() => {})
    }
  }
}

function resolveBranchLineage(
  branchName: string,
  parentMap: Map<string, string>,
): { trunk: string; depth: number } | null {
  if (!parentMap.has(branchName)) return null

  let current = branchName
  let depth = 0
  const visited = new Set<string>()
  while (parentMap.has(current) && !visited.has(current)) {
    visited.add(current)
    const parent = parentMap.get(current)!
    depth += 1
    if (!parentMap.has(parent)) {
      return { trunk: parent, depth }
    }
    current = parent
  }

  return null
}

/**
 * Build a linear stack chain containing a given branch.
 * Walks up from the branch to find the root, then walks down to find the full chain.
 * The trunk (e.g. main) is prepended so even single-branch stacks show context.
 */
function buildStackChain(
  branchName: string,
  parentMap: Map<string, string>,
): GraphiteBranchInfo[] | null {
  if (!parentMap.has(branchName)) return null

  // Build child map (parent → children)
  const childMap = new Map<string, string[]>()
  for (const [child, parent] of parentMap) {
    const children = childMap.get(parent) ?? []
    children.push(child)
    childMap.set(parent, children)
  }

  // Walk up to find root (a branch whose parent is not itself a graphite branch)
  let root = branchName
  let trunk: string | null = null
  const visited = new Set<string>()
  while (parentMap.has(root) && !visited.has(root)) {
    visited.add(root)
    const parent = parentMap.get(root)!
    if (!parentMap.has(parent)) {
      trunk = parent
      break
    }
    root = parent
  }

  // Start chain with the trunk branch (e.g. main) so the stack has context
  const chain: GraphiteBranchInfo[] = []
  if (trunk) {
    chain.push({ name: trunk, parent: null })
  }

  // Walk down from root to build the rest of the chain
  let current: string | undefined = root
  const chainVisited = new Set<string>()
  while (current && !chainVisited.has(current)) {
    chainVisited.add(current)
    chain.push({
      name: current,
      parent: parentMap.get(current) ?? null,
    })
    const children: string[] = childMap.get(current) ?? []
    if (children.length === 0) break
    if (children.length === 1) {
      current = children[0]
    } else {
      current = children.find((c: string) => {
        let walk: string | undefined = branchName
        const walkVisited = new Set<string>()
        while (walk && !walkVisited.has(walk)) {
          walkVisited.add(walk)
          if (walk === c) return true
          walk = parentMap.get(walk)
        }
        return false
      }) ?? children[0]
    }
  }

  return chain.length > 1 ? chain : null
}

function validateStackBranchNameArg(raw: string): string {
  const name = raw.trim()
  if (!name) throw new Error('Branch name is required.')
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Branch name cannot contain slashes or "..".')
  }
  if (name.startsWith('-')) throw new Error('Branch name cannot start with "-".')
  return name
}

function sortCreateBranches(
  a: GraphiteCreateBranchOption,
  b: GraphiteCreateBranchOption,
): number {
  if (a.trunk !== b.trunk) return a.trunk.localeCompare(b.trunk)
  if (a.depth !== b.depth) return a.depth - b.depth
  if (a.parent !== b.parent) return (a.parent ?? '').localeCompare(b.parent ?? '')
  return a.name.localeCompare(b.name)
}

export class GraphiteService {
  private static gtAvailable: boolean | null = null

  private static async currentBranch(worktreePath: string): Promise<string> {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)
    if (!branch || branch === 'HEAD') throw new Error('Graphite stack actions require a named branch.')
    return branch
  }

  private static normalizeBranch(branch: string): string {
    return branch.trim().replace(/^refs\/heads\//, '').replace(/^origin\//, '')
  }

  private static ensureDefaultBranchName(branch: string, defaultBranch: string): string {
    const normalizedBranch = this.normalizeBranch(branch)
    const normalizedDefaultBranch = this.normalizeBranch(defaultBranch)
    if (!normalizedDefaultBranch) throw new Error('Default branch is required for Graphite stack actions.')
    if (normalizedBranch !== normalizedDefaultBranch) {
      throw new Error(GRAPHITE_DEFAULT_BRANCH_ONLY_ERROR)
    }
    return normalizedBranch
  }

  private static async ensureDefaultBranch(worktreePath: string, defaultBranch: string): Promise<string> {
    const branch = await this.currentBranch(worktreePath)
    return this.ensureDefaultBranchName(branch, defaultBranch)
  }

  private static async resolveRepoDefaultBranch(repoPath: string): Promise<string> {
    const remoteHeadRef = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoPath).catch(() => '')
    if (remoteHeadRef) return this.normalizeBranch(remoteHeadRef.replace(/^refs\/remotes\//, ''))

    const current = this.normalizeBranch(await this.currentBranch(repoPath).catch(() => ''))
    if (['main', 'master', 'production'].includes(current)) return current

    for (const candidate of ['main', 'master', 'production']) {
      const exists = await git(['rev-parse', '--verify', `refs/heads/${candidate}`], repoPath)
        .then(() => true, () => false)
      if (exists) return candidate
    }

    return this.normalizeBranch(await GitService.getDefaultBranch(repoPath))
  }

  private static async ensureRepoDefaultBranch(repoPath: string): Promise<string> {
    const defaultBranch = await this.resolveRepoDefaultBranch(repoPath)
    return this.ensureDefaultBranch(repoPath, defaultBranch)
  }

  private static async hasStagedChanges(worktreePath: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd: worktreePath })
      return false
    } catch {
      return true
    }
  }

  static async isGtAvailable(): Promise<boolean> {
    if (this.gtAvailable !== null) return this.gtAvailable
    try {
      await execFileAsync('gt', ['--version'], { timeout: 5000 })
      this.gtAvailable = true
    } catch {
      this.gtAvailable = false
    }
    return this.gtAvailable
  }

  private static async ensureGtAvailable(): Promise<void> {
    if (!(await this.isGtAvailable())) {
      throw new Error('Graphite CLI is not installed.')
    }
  }

  private static async isInitialized(repoPath: string): Promise<boolean> {
    try {
      const gitCommonDir = await resolveGitCommonDir(repoPath)
      return existsSync(join(gitCommonDir, '.graphite_repo_config'))
    } catch {
      return false
    }
  }

  private static async ensureInitialized(repoPath: string, defaultBranch: string): Promise<void> {
    if (await this.isInitialized(repoPath)) return
    try {
      await graphite(['--no-interactive', 'init', '--trunk', defaultBranch], repoPath)
    } catch (err) {
      throw new Error(graphiteErrorMessage(err, 'Failed to initialize Graphite.'))
    }
  }

  private static async ensureTracked(
    repoPath: string,
    worktreePath: string,
    branch: string,
    defaultBranch: string,
  ): Promise<void> {
    if (branch === defaultBranch) return
    const parentMap = await parseGraphiteMetadata(repoPath)
    if (parentMap.has(branch)) return

    try {
      await graphite(['--no-interactive', 'track', '--force'], worktreePath)
      return
    } catch {
      // Fall through to explicit parent selection.
    }

    try {
      await graphite(['--no-interactive', 'track', '--parent', defaultBranch], worktreePath)
    } catch (err) {
      throw new Error(graphiteErrorMessage(err, `Failed to track branch "${branch}" with Graphite.`))
    }
  }

  /**
   * Get the graphite stack info for a worktree.
   * Reads graphite metadata from git config, finds the stack containing
   * the current branch, and returns it ordered root → tip.
   */
  static async getStackInfo(repoPath: string, worktreePath: string): Promise<GraphiteStackInfo | null> {
    const parentMap = await parseGraphiteMetadata(repoPath)
    if (parentMap.size === 0) return null

    let currentBranch: string
    try {
      currentBranch = await this.currentBranch(worktreePath)
    } catch {
      return null
    }

    const chain = buildStackChain(currentBranch, parentMap)
    if (!chain) return null

    return { branches: chain, currentBranch }
  }

  static async getCreateOptions(repoPath: string): Promise<GraphiteCreateOptions | null> {
    const parentMap = await parseGraphiteMetadata(repoPath)
    if (parentMap.size === 0) return null

    const trunks = new Set<string>()
    const branches: GraphiteCreateBranchOption[] = []
    for (const [name, parent] of parentMap.entries()) {
      const lineage = resolveBranchLineage(name, parentMap)
      if (!lineage) continue
      trunks.add(lineage.trunk)
      branches.push({
        name,
        parent,
        trunk: lineage.trunk,
        depth: lineage.depth,
      })
    }

    branches.sort(sortCreateBranches)
    return {
      trunks: Array.from(trunks).sort((a, b) => a.localeCompare(b)),
      branches,
    }
  }

  static async setBranchParent(repoPath: string, branch: string, parent: string): Promise<void> {
    await this.ensureRepoDefaultBranch(repoPath)
    const branchName = branch.trim()
    const parentName = parent.trim()
    if (!branchName) throw new Error('Graphite branch name is required')
    if (!parentName) throw new Error('Graphite parent branch is required')
    await writeGraphiteMetadata(repoPath, [{ name: branchName, parent: parentName }])
  }

  static async runStackAction(
    repoPath: string,
    worktreePath: string,
    action: GraphiteStackAction,
    commitMessage: string,
    defaultBranch: string,
    stackBranchName?: string,
  ): Promise<GraphiteStackActionResult> {
    const baseBranch = this.normalizeBranch(defaultBranch)
    let branch = await this.ensureDefaultBranch(worktreePath, baseBranch)
    if (action !== 'start-stack') throw new Error(GRAPHITE_SINGLE_ACTION_ERROR)

    await this.ensureGtAvailable()
    await this.ensureInitialized(repoPath, baseBranch)
    await this.ensureTracked(repoPath, worktreePath, branch, baseBranch)

    const trimmedMessage = commitMessage.trim()
    if (action === 'start-stack' || action === 'add-to-stack') {
      if (!(await this.hasStagedChanges(worktreePath))) {
        throw new Error('Stage changes before creating a Graphite stack branch.')
      }
      if (!trimmedMessage) {
        throw new Error('Commit message is required to create a Graphite stack branch.')
      }

      const named =
        typeof stackBranchName === 'string' && stackBranchName.trim()
          ? validateStackBranchNameArg(stackBranchName)
          : null

      try {
        if (named) {
          await graphite(
            ['--no-interactive', 'create', named, '-m', trimmedMessage],
            worktreePath,
          )
        } else {
          await graphite(['--no-interactive', 'create', '-m', trimmedMessage], worktreePath)
        }
      } catch (err) {
        throw new Error(graphiteErrorMessage(err, 'Failed to create a Graphite stack branch.'))
      }
      branch = await this.currentBranch(worktreePath)
    }

    try {
      await graphite(['--no-interactive', 'submit', '--stack', '--draft', '--no-edit', '--view'], worktreePath)
    } catch (err) {
      throw new Error(graphiteErrorMessage(err, 'Failed to submit Graphite stack.'))
    }

    return { branch }
  }

  /**
   * Checkout a branch in the given worktree.
   */
  static async checkoutBranch(worktreePath: string, branch: string): Promise<string> {
    await git(['checkout', branch], worktreePath)
    return branch
  }

  /**
   * Clone an entire Graphite stack into a new worktree.
   * Creates a worktree at the tip branch, then creates local tracking branches for the rest.
   */
  static async cloneStack(
    repoPath: string,
    name: string,
    prBranches: { name: string; parent: string | null }[],
    credentialRules?: WorktreeCredentialRule[],
  ): Promise<{ worktreePath: string; branch: string }> {
    await this.ensureRepoDefaultBranch(repoPath)
    if (prBranches.length === 0) throw new Error('No branches in stack')

    // Fetch latest
    await git(['fetch', '--prune', 'origin'], repoPath).catch(() => {})

    const tipBranch = prBranches[prBranches.length - 1].name
    const parentDir = dirname(repoPath)
    const repoName = basename(repoPath)
    const safeName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 80) || 'stack'
    const worktreePath = resolve(parentDir, `${repoName}-ws-${safeName}`)
    const replacingExistingPath = existsSync(worktreePath)

    // Clean stale worktree refs
    await GitService.pruneWorktrees(repoPath)

    // Remove existing directory if present
    if (replacingExistingPath) {
      await GitService.removeExistingWorkspacePath(repoPath, worktreePath)
    }

    // Check if tip branch exists locally
    const tipExists = await git(['rev-parse', '--verify', `refs/heads/${tipBranch}`], repoPath)
      .then(() => true, () => false)

    // Create worktree at tip
    const addArgs = ['worktree', 'add']
    if (replacingExistingPath) addArgs.push('--force')
    if (tipExists) {
      await git([...addArgs, worktreePath, tipBranch], repoPath)
    } else {
      // Create from remote tracking branch
      const remoteExists = await git(['rev-parse', '--verify', `refs/remotes/origin/${tipBranch}`], repoPath)
        .then(() => true, () => false)
      if (remoteExists) {
        await git([...addArgs, '-b', tipBranch, worktreePath, `origin/${tipBranch}`], repoPath)
      } else {
        throw new Error(`Branch "${tipBranch}" not found locally or on origin`)
      }
    }

    // Create local tracking branches for all non-tip branches
    for (const entry of prBranches) {
      if (entry.name === tipBranch) continue
      const exists = await git(['rev-parse', '--verify', `refs/heads/${entry.name}`], repoPath)
        .then(() => true, () => false)
      if (!exists) {
        const remoteExists = await git(['rev-parse', '--verify', `refs/remotes/origin/${entry.name}`], repoPath)
          .then(() => true, () => false)
        if (remoteExists) {
          await git(['branch', '--track', entry.name, `origin/${entry.name}`], repoPath).catch(() => {})
        }
      }
    }

    await writeGraphiteMetadata(
      repoPath,
      prBranches
        .filter((entry): entry is { name: string; parent: string } => entry.parent != null)
        .map((entry) => ({ name: entry.name, parent: entry.parent })),
    )

    // Copy repo-local credential artifacts from the main repo.
    await copyWorktreeCredentialArtifacts(repoPath, worktreePath, credentialRules)

    return { worktreePath, branch: tipBranch }
  }

  /**
   * Discover the graphite stack containing a given PR branch.
   * Fetches from origin first to ensure branches are up to date.
   */
  static async getStackForPr(
    repoPath: string,
    prBranch: string,
  ): Promise<{ name: string; parent: string | null }[] | null> {
    // Fetch to get latest remote branches and graphite config
    await git(['fetch', '--prune', 'origin'], repoPath).catch(() => {})

    const parentMap = await parseGraphiteMetadata(repoPath)
    if (parentMap.size === 0) return null

    const chain = buildStackChain(prBranch, parentMap)
    if (!chain) return null

    return chain.map((b) => ({ name: b.name, parent: b.parent }))
  }
}
