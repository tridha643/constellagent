import { execFile, type ExecFileException } from 'child_process'
import { homedir } from 'os'
import { promisify } from 'util'
import * as pty from 'node-pty'

const execFileAsync = promisify(execFile)
const PI_GENERATE_TIMEOUT_MS = 30_000
const PI_GENERATE_MAX_BUFFER = 1024 * 1024
const GIT_MAX_BUFFER = 10 * 1024 * 1024
const PI_COMMIT_MESSAGE_MODEL = 'composer-2-fast'
const PI_OUTPUT_IDLE_MS = 750
const STATUS_MAX_CHARS = 4_000
const SUMMARY_MAX_CHARS = 3_500
const RECENT_COMMITS_MAX_CHARS = 1_000

const CONVENTIONAL_COMMIT_RE = /^[a-z]+(?:\([^)]+\))?(?:!)?:\s+.+$/i

interface CommitMessageSnapshot {
  status: string
  stagedSummary: string
  unstagedSummary: string
  recentCommits: string
}

function truncateSection(text: string, maxChars: number): string {
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

async function buildSnapshot(worktreePath: string): Promise<CommitMessageSnapshot> {
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
    recentCommits: truncateSection(recentCommits, RECENT_COMMITS_MAX_CHARS),
  }
}

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

async function runPiPrompt(prompt: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    let sawMeaningfulOutput = false
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const proc = pty.spawn('pi', [
      '--mode',
      'text',
      '--print',
      '--no-session',
      '--no-tools',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--thinking',
      'off',
      '--model',
      PI_COMMIT_MESSAGE_MODEL,
      prompt,
    ], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: homedir(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    const clearIdleTimer = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const finalize = (result: { ok: true; value: string } | { ok: false; error: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      clearIdleTimer()
      try {
        proc.kill()
      } catch {
        // ignore kill failures after process exit
      }
      if (result.ok) resolve(result.value)
      else reject(result.error)
    }

    const scheduleIdleFinish = (): void => {
      if (!sawMeaningfulOutput) return
      clearIdleTimer()
      idleTimer = setTimeout(() => {
        finalize({ ok: true, value: output })
      }, PI_OUTPUT_IDLE_MS)
    }

    const timeoutTimer = setTimeout(() => {
      finalize({ ok: false, error: new Error('Pi commit-message generation timed out.') })
    }, PI_GENERATE_TIMEOUT_MS)

    proc.onData((chunk) => {
      output += chunk
      if (stripTerminalNoise(chunk).trim()) {
        sawMeaningfulOutput = true
      }
      if (output.length > PI_GENERATE_MAX_BUFFER) {
        finalize({ ok: false, error: new Error('Pi commit-message generation produced too much output.') })
        return
      }
      scheduleIdleFinish()
    })

    proc.onExit(({ exitCode }) => {
      if (settled) return
      const cleaned = stripTerminalNoise(output).trim()
      if (cleaned) {
        finalize({ ok: true, value: output })
        return
      }
      if (exitCode === 0) {
        finalize({ ok: false, error: new Error('Pi did not return a commit message.') })
        return
      }
      finalize({ ok: false, error: new Error('Failed to generate a commit message with Pi.') })
    })
  })
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
    const snapshot = await buildSnapshot(worktreePath)

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
