import type { ExecFileException } from 'child_process'
import { buildCommitMessageSnapshot, type CommitMessageSnapshot } from './git-snapshot'
import { runPiPrompt } from './pi-run-prompt'

const CONVENTIONAL_COMMIT_RE = /^[a-z]+(?:\([^)]+\))?(?:!)?:\s+.+$/i

function buildPrompt(snapshot: CommitMessageSnapshot): string {
  const sections = [
    ['Git status', snapshot.status],
    ['Recent commit subjects', snapshot.recentCommits],
    ['Staged diff summary', snapshot.stagedSummary],
    ['Unstaged diff summary', snapshot.unstagedSummary],
  ]
    .filter(([, body]) => body.trim().length > 0)
    .map(([title, body]) => `## ${title}\n${body}`)
    .join('\n\n')

  return `You are generating a git commit message from repository context that has already been collected for you.

Do not inspect the repository. Do not request tools. Use only the snapshot below.
Return exactly one line in the format "type(scope): message".
Choose a scope from the dominant app or area implied by the file paths and recent commits.
Focus on the main intent of the change rather than listing every file.

${sections}`
}

function extractExecErrorLine(err: unknown): string {
  const stderr =
    typeof err === 'object' && err !== null && 'stderr' in err
      ? String((err as { stderr?: unknown }).stderr ?? '').trim()
      : ''
  if (stderr) {
    const line = stderr.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).pop()
    if (line) return line
  }

  const stdout =
    typeof err === 'object' && err !== null && 'stdout' in err
      ? String((err as { stdout?: unknown }).stdout ?? '').trim()
      : ''
  if (stdout) {
    const line = stdout.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).pop()
    if (line) return line
  }

  return err instanceof Error ? err.message.trim() : ''
}

function formatPiError(err: unknown): string {
  const execErr = err as Partial<ExecFileException> & {
    code?: string | number | null
    killed?: boolean
    signal?: NodeJS.Signals | string | null
  }

  if (execErr?.code === 'ENOENT') {
    return 'The `pi` CLI is not installed or is not available on PATH.'
  }

  if (execErr?.killed || execErr?.signal === 'SIGTERM') {
    return 'Pi commit-message generation timed out.'
  }

  const detail = extractExecErrorLine(err)
  return detail || 'Failed to generate a commit message with Pi.'
}

function stripTerminalNoise(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '')
}

function unwrapFence(text: string): string {
  const trimmed = stripTerminalNoise(text).trim()
  const fenceMatch = trimmed.match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  if (fenceMatch) return fenceMatch[1].trim()
  return trimmed
}

function cleanCandidate(line: string): string {
  return line
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^`+/, '')
    .replace(/`+$/, '')
    .replace(/^['"]+/, '')
    .replace(/['"]+$/, '')
    .trim()
}

function normalizeCommitMessage(stdout: string): string {
  const unwrapped = unwrapFence(stdout)
  const lines = unwrapped
    .split(/\r?\n/)
    .map(cleanCandidate)
    .filter(Boolean)

  const exact = lines.find((line) => CONVENTIONAL_COMMIT_RE.test(line))
  if (exact) return exact

  if (lines.length === 1) return lines[0]

  const inline = cleanCandidate(unwrapped.replace(/\s+/g, ' '))
  if (CONVENTIONAL_COMMIT_RE.test(inline)) return inline

  return lines[0] ?? ''
}

export class CommitMessageService {
  static async generateWithPi(worktreePath: string): Promise<string> {
    const snapshot = await buildCommitMessageSnapshot(worktreePath)

    try {
      const stdout = await runPiPrompt(buildPrompt(snapshot))
      const message = normalizeCommitMessage(stdout)
      if (!message) {
        throw new Error('Pi did not return a commit message.')
      }
      return message
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : formatPiError(err))
    }
  }
}
