import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const GIT_MAX_BUFFER = 10 * 1024 * 1024
const STATUS_MAX_CHARS = 4_000
const SUMMARY_MAX_CHARS = 3_500
const RECENT_COMMITS_MAX_CHARS = 2_000

export function truncateSection(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const remaining = trimmed.length - maxChars
  return `${trimmed.slice(0, maxChars).trimEnd()}\n... [truncated ${remaining} chars]`
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: GIT_MAX_BUFFER,
  })
  return stdout.trim()
}

async function gitOrEmpty(args: string[], cwd: string): Promise<string> {
  try {
    return await git(args, cwd)
  } catch {
    return ''
  }
}

/** Snapshot for Pi Linear drafts — never throws; empty repo sections become empty strings. */
export interface GitSnapshotForLinearDraft {
  status: string
  stagedSummary: string
  unstagedSummary: string
  recentCommits: string
}

export async function buildGitSnapshotForLinearDraft(
  worktreePath: string,
): Promise<GitSnapshotForLinearDraft> {
  const [status, stagedSummary, unstagedSummary, recentCommits] = await Promise.all([
    gitOrEmpty(['status', '--porcelain=v1', '-uall'], worktreePath),
    gitOrEmpty(['diff', '--staged', '--stat', '--summary', '--find-renames'], worktreePath),
    gitOrEmpty(['diff', '--stat', '--summary', '--find-renames'], worktreePath),
    gitOrEmpty(['log', '--format=%s', '-n', '20'], worktreePath),
  ])

  return {
    status: truncateSection(status, STATUS_MAX_CHARS),
    stagedSummary: truncateSection(stagedSummary, SUMMARY_MAX_CHARS),
    unstagedSummary: truncateSection(unstagedSummary, SUMMARY_MAX_CHARS),
    recentCommits: truncateSection(recentCommits, RECENT_COMMITS_MAX_CHARS),
  }
}

/** Snapshot for commit messages — requires uncommitted changes (same behavior as legacy CommitMessageService). */
export interface CommitMessageSnapshot {
  status: string
  stagedSummary: string
  unstagedSummary: string
  recentCommits: string
}

export async function buildCommitMessageSnapshot(worktreePath: string): Promise<CommitMessageSnapshot> {
  const [status, stagedSummary, unstagedSummary, recentCommits] = await Promise.all([
    git(['status', '--porcelain=v1', '-uall'], worktreePath),
    gitOrEmpty(['diff', '--staged', '--stat', '--summary', '--find-renames'], worktreePath),
    gitOrEmpty(['diff', '--stat', '--summary', '--find-renames'], worktreePath),
    gitOrEmpty(['log', '--format=%s', '-n', '6'], worktreePath),
  ])

  if (!status.trim()) {
    throw new Error('No uncommitted changes to summarize.')
  }

  return {
    status: truncateSection(status, STATUS_MAX_CHARS),
    stagedSummary: truncateSection(stagedSummary, SUMMARY_MAX_CHARS),
    unstagedSummary: truncateSection(unstagedSummary, SUMMARY_MAX_CHARS),
    recentCommits: truncateSection(recentCommits, 1_000),
  }
}
