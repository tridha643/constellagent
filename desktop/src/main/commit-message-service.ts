import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const PI_GENERATE_TIMEOUT_MS = 120_000
const PI_GENERATE_MAX_BUFFER = 1024 * 1024

const CREATE_COMMIT_MESSAGE_PROMPT = `---
name: create-commit-message
description: Create a conventional commit message from uncommitted changes.
---

Look at all my uncommitted changes in the current git repository, including staged, unstaged, and untracked files.
Create an appropriate conventional commit message.
Follow the format "type(scope): message" where scope is the app name or area (e.g., boardy-server, ci, admin-dashboard).
Inspect the repository yourself using available read-only tools and git commands if needed.
Return only the commit message line. Do not include any explanation or surrounding code fences.`

const CONVENTIONAL_COMMIT_RE = /^[a-z]+(?:\([^)]+\))?(?:!)?:\s+.+$/i

function unwrapFence(text: string): string {
  const trimmed = text.trim()
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
    const { stdout } = await execFileAsync('pi', [
      '--print',
      '--no-session',
      '--tools',
      'read,bash,grep,find,ls',
      CREATE_COMMIT_MESSAGE_PROMPT,
    ], {
      cwd: worktreePath,
      timeout: PI_GENERATE_TIMEOUT_MS,
      maxBuffer: PI_GENERATE_MAX_BUFFER,
    })

    const message = normalizeCommitMessage(stdout)
    if (!message) {
      throw new Error('PI did not return a commit message.')
    }
    return message
  }
}
