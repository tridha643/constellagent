import { execFile, type ExecFileException } from 'child_process'
import { createHash } from 'crypto'
import { promisify } from 'util'
import type {
  TerminalSessionAvailability,
  TerminalSessionSummary,
} from '../shared/terminal-session-types'

const execFileAsync = promisify(execFile)
const SESSION_PREFIX = 'ca'

type ExecFileImpl = (
  file: string,
  args: string[],
  opts: { encoding: BufferEncoding },
) => Promise<{ stdout: string; stderr: string }>

export interface TmuxServiceOptions {
  userDataPath: string
  tmuxPath?: string
  execFileImpl?: ExecFileImpl
}

export class TmuxService {
  private readonly userDataPath: string
  private readonly tmuxPath: string
  private readonly execFileImpl: ExecFileImpl
  private availabilityCache: TerminalSessionAvailability | null = null

  constructor(options: TmuxServiceOptions) {
    this.userDataPath = options.userDataPath
    this.tmuxPath = options.tmuxPath || 'tmux'
    this.execFileImpl = options.execFileImpl || ((file, args, opts) => execFileAsync(file, args, opts) as Promise<{ stdout: string; stderr: string }>)
  }

  socketName(): string {
    const hash = createHash('sha1').update(this.userDataPath).digest('hex').slice(0, 10)
    return `constellagent-${hash}`
  }

  makeSessionName(workspaceId: string, terminalId: string): string {
    return `${SESSION_PREFIX}-${sanitizeSegment(workspaceId)}-${sanitizeSegment(terminalId)}`
  }

  parseSessionName(sessionName: string): { workspaceId: string; terminalId: string } | null {
    if (!sessionName.startsWith(`${SESSION_PREFIX}-`)) return null
    const body = sessionName.slice(SESSION_PREFIX.length + 1)
    const terminalId = body.slice(-36)
    const separator = body.slice(-37, -36)
    const workspaceId = body.slice(0, -37)
    if (!workspaceId || !terminalId || separator !== '-') return null
    return { workspaceId, terminalId }
  }

  async getAvailability(): Promise<TerminalSessionAvailability> {
    if (this.availabilityCache) return this.availabilityCache
    try {
      const { stdout } = await this.execFileImpl(this.tmuxPath, ['-V'], { encoding: 'utf8' })
      const version = stdout.trim()
      this.availabilityCache = {
        available: true,
        backend: 'tmux',
        tmuxPath: this.tmuxPath,
        version,
      }
    } catch (error) {
      this.availabilityCache = {
        available: false,
        backend: 'local',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return this.availabilityCache
  }

  async hasSession(sessionName: string): Promise<boolean> {
    try {
      await this.tmux(['has-session', '-t', sessionName])
      return true
    } catch {
      return false
    }
  }

  async ensureSession(opts: { sessionName: string; cwd: string; shell?: string }): Promise<void> {
    if (await this.hasSession(opts.sessionName)) {
      await this.configureServer(opts.sessionName)
      return
    }
    const args = ['new-session', '-d', '-s', opts.sessionName, '-c', opts.cwd]
    if (opts.shell?.trim()) args.push(opts.shell.trim())
    // Chain `set status off` into the same invocation (`;` is tmux's command
    // separator) so the bar is gone the instant the server/session is born —
    // it never flashes, even before the follow-up configureServer() lands.
    args.push(';', 'set-option', '-t', opts.sessionName, 'status', 'off')
    await this.tmux(args)
    await this.configureServer(opts.sessionName)
  }

  /**
   * Hide the green tmux status bar (`status off`) so embedded terminals look
   * like a plain shell instead of leaking the `[ca-…:zsh* "Mac" …]` chrome.
   *
   * We set it three ways for robustness:
   *  - `-g` (server default) covers every session on the socket, including
   *    ones created before this option existed — so reattaching an old session
   *    also hides its bar.
   *  - targeted `-t <session>` wins even if a `~/.tmux.conf` set a session-level
   *    `status on` that would otherwise shadow the global default.
   */
  async configureServer(sessionName?: string): Promise<void> {
    try {
      await this.tmux(['set-option', '-g', 'status', 'off'])
      if (sessionName) {
        await this.tmux(['set-option', '-t', sessionName, 'status', 'off'])
      }
    } catch {
      // Cosmetic only — never block attach if the option can't be set.
    }
  }

  attachCommand(sessionName: string): string[] {
    return [
      this.tmuxPath,
      '-L',
      this.socketName(),
      'attach-session',
      '-t',
      sessionName,
    ]
  }

  async killSession(sessionName: string): Promise<void> {
    await this.tmux(['kill-session', '-t', sessionName])
  }

  /**
   * Type `command` into the session's active pane and run it. Sent in two
   * steps — the command literally (`-l`, so a name like "Enter" inside the
   * command isn't interpreted as a key) followed by a real Enter keypress.
   * Goes into the pane's input buffer, so the shell runs it as soon as it is
   * ready even if rc files are still sourcing.
   */
  async runCommand(sessionName: string, command: string): Promise<void> {
    const trimmed = command.trim()
    if (!trimmed) return
    await this.tmux(['send-keys', '-t', sessionName, '-l', '--', trimmed])
    await this.tmux(['send-keys', '-t', sessionName, 'Enter'])
  }

  async listSessions(workspaceId?: string): Promise<TerminalSessionSummary[]> {
    const format = '#{session_name}\t#{session_created}\t#{session_attached}'
    let stdout = ''
    try {
      ;({ stdout } = await this.tmux(['list-sessions', '-F', format]))
    } catch (error) {
      if (isTmuxNoServerError(error)) return []
      throw error
    }

    const summaries: TerminalSessionSummary[] = []
    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue
      const [sessionName, createdRaw, attachedRaw] = line.split('\t')
      if (!sessionName || !sessionName.startsWith(`${SESSION_PREFIX}-`)) continue
      const parsed = this.parseSessionName(sessionName)
      if (workspaceId && parsed?.workspaceId !== workspaceId) continue
      summaries.push({
        backend: 'tmux',
        sessionName,
        workspaceId: parsed?.workspaceId ?? null,
        terminalId: parsed?.terminalId ?? null,
        createdAt: Number.isFinite(Number(createdRaw)) ? Number(createdRaw) * 1000 : undefined,
        attachedClients: Number.isFinite(Number(attachedRaw)) ? Number(attachedRaw) : undefined,
      })
    }
    return summaries
  }

  private async tmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return this.execFileImpl(this.tmuxPath, ['-L', this.socketName(), ...args], { encoding: 'utf8' })
  }
}

function sanitizeSegment(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-')
  return sanitized.slice(0, 96) || 'unknown'
}

function isTmuxNoServerError(error: unknown): boolean {
  const err = error as ExecFileException | undefined
  const text = `${err?.message ?? ''}\n${err?.stderr ?? ''}`
  return /no server running|failed to connect|error connecting/i.test(text)
}
