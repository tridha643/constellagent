/**
 * Codex Conductor driver — maps `@openai/codex-sdk` thread items to the shared timeline.
 *
 * The Codex TypeScript SDK does not expose delegated subagent runs as a first-class
 * `ThreadItem` (unlike Cursor's `tool_call` / task tool). Subagent-style cards in
 * Conductor are therefore Cursor-only unless a future SDK item type is added.
 */
import { execFileSync } from 'node:child_process'
import {
  Codex,
  type ModelReasoningEffort,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
} from '@openai/codex-sdk'
import { checkCodexAuth, getOpenaiApiKey } from '../conductor-auth'
import { mapThinkingLevelToCodexEffort, parseModelEffort } from '../../shared/conductor-model-utils'
import {
  computeTextDelta,
  evAssistantDelta,
  evToolFinished,
  evToolStarted,
  evToolUpdated,
  buildAgentPrompt,
  type AgentDriver,
  type AgentTurnContext,
} from './agent-driver'

interface CodexSessionState {
  thread: Thread
  /** From `thread.started` — used with `resumeThread()` if the in-memory Thread is lost. */
  codexThreadId: string | null
  model: string
  effort: ModelReasoningEffort
  plan: boolean
  readonly emittedByItem: Map<string, string>
}

interface CodexSessionRecovery {
  codexThreadId: string | null
  model: string
  effort: ModelReasoningEffort
  plan: boolean
  /** After user interrupt or stale resume — next turn seeds Conductor transcript instead of CLI resume. */
  preferTranscriptFallback: boolean
}

function toolDescriptor(item: ThreadItem): { toolName: string; input?: unknown } | null {
  switch (item.type) {
    case 'command_execution':
      return { toolName: 'shell', input: item.command }
    case 'mcp_tool_call':
      return { toolName: `${item.server}.${item.tool}`, input: item.arguments }
    case 'web_search':
      return { toolName: 'web_search', input: item.query }
    case 'file_change':
      return { toolName: 'apply_patch', input: item.changes }
    case 'todo_list':
      return { toolName: 'todowrite', input: item.items }
    default:
      return null
  }
}

function toolSucceeded(item: ThreadItem): boolean {
  if (item.type === 'command_execution') return item.status === 'completed' && (item.exit_code ?? 0) === 0
  if (item.type === 'mcp_tool_call') return item.status === 'completed'
  if (item.type === 'file_change') return item.status === 'completed'
  return true
}

/** Codex CLI cannot resume a thread after abort or a failed rollout — drop cached Thread state. */
export function isStaleCodexThreadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  return lower.includes('thread/resume') || lower.includes('no rollout')
}

/**
 * Expected errors when the user stops a turn via `TurnOptions.signal` (AbortSignal).
 * The TS SDK has no separate interrupt API — aborting the signal is the documented cancel path.
 */
export function isBenignCodexInterruptError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true
    const lower = err.message.toLowerCase()
    if (lower.includes('aborted')) return true
    if (lower.includes('codex exec exited with signal')) return true
  }
  return false
}

/** Prefer a `codex` on PATH so we do not require @openai/codex optional vendor binaries at app load. */
function resolveCodexCliPath(): string | undefined {
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(lookup, ['codex'], { encoding: 'utf8' })
    const line = out.trim().split(/\r?\n/)[0]?.trim()
    return line || undefined
  } catch {
    return undefined
  }
}

function threadOptionsForTurn(ctx: AgentTurnContext): ThreadOptions {
  const baseModel = parseModelEffort(ctx.model).base
  const effort = mapThinkingLevelToCodexEffort(ctx.thinkingLevel)
  return {
    model: baseModel,
    modelReasoningEffort: effort,
    workingDirectory: ctx.workspacePath,
    skipGitRepoCheck: true,
    ...(ctx.plan ? { sandboxMode: 'read-only' as const } : {}),
  }
}

function configMatches(
  state: CodexSessionState | CodexSessionRecovery,
  model: string,
  effort: ModelReasoningEffort,
  plan: boolean,
): boolean {
  return state.model === model && state.effort === effort && state.plan === plan
}

export class CodexDriver implements AgentDriver {
  readonly provider = 'codex' as const
  private codex: Codex | null = null
  private readonly sessions = new Map<string, CodexSessionState>()
  private readonly recovery = new Map<string, CodexSessionRecovery>()

  private getCodex(): Codex {
    if (!this.codex) {
      const codexPathOverride = resolveCodexCliPath()
      this.codex = new Codex({
        ...(getOpenaiApiKey() ? { apiKey: getOpenaiApiKey() } : {}),
        ...(codexPathOverride ? { codexPathOverride } : {}),
      })
    }
    return this.codex
  }

  checkAuth(): string | null {
    return checkCodexAuth()
  }

  async runTurn(ctx: AgentTurnContext): Promise<void> {
    try {
      await this.runTurnOnce(ctx, false)
    } catch (err) {
      if (isBenignCodexInterruptError(err, ctx.signal)) return
      if (isStaleCodexThreadError(err)) {
        this.sessions.delete(ctx.sessionRef.sessionId)
        await this.runTurnOnce(ctx, true)
        return
      }
      throw err
    }
  }

  /**
   * Mark a session interrupted so the next turn uses Conductor transcript seeding
   * instead of resuming a broken CLI rollout.
   */
  markSessionInterrupted(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state) {
      this.recovery.set(sessionId, {
        codexThreadId: state.codexThreadId ?? state.thread.id,
        model: state.model,
        effort: state.effort,
        plan: state.plan,
        preferTranscriptFallback: true,
      })
    }
    this.sessions.delete(sessionId)
  }

  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.recovery.delete(sessionId)
  }

  private async runTurnOnce(ctx: AgentTurnContext, forceTranscriptFallback: boolean): Promise<void> {
    const key = ctx.sessionRef.sessionId
    const options = threadOptionsForTurn(ctx)
    const baseModel = options.model!
    const effort = options.modelReasoningEffort!
    const plan = ctx.plan

    const existing = this.sessions.get(key)
    const recovery = this.recovery.get(key)
    const configChanged =
      (existing && !configMatches(existing, baseModel, effort, plan)) ||
      (recovery && !configMatches(recovery, baseModel, effort, plan))

    let state: CodexSessionState
    let seedTranscript = forceTranscriptFallback

    if (existing && !configChanged && !forceTranscriptFallback) {
      // SDK primary path: same Thread instance, repeated runStreamed (see sdk/typescript/README.md).
      state = existing
      existing.emittedByItem.clear()
    } else if (!forceTranscriptFallback && !configChanged && recovery?.codexThreadId && !recovery.preferTranscriptFallback) {
      // In-memory Thread lost but persisted session may still be resumable (~/.codex/sessions).
      const thread = this.getCodex().resumeThread(recovery.codexThreadId, options)
      this.recovery.delete(key)
      state = {
        thread,
        codexThreadId: recovery.codexThreadId,
        model: baseModel,
        effort,
        plan,
        emittedByItem: new Map(),
      }
      this.sessions.set(key, state)
    } else if (!forceTranscriptFallback && !configChanged && recovery?.codexThreadId && recovery.preferTranscriptFallback) {
      // Interrupted prior turn — do not resume a broken rollout; seed transcript on a fresh thread.
      const thread = this.getCodex().startThread(options)
      seedTranscript = Boolean(ctx.previousTranscript?.length)
      this.recovery.delete(key)
      state = {
        thread,
        codexThreadId: null,
        model: baseModel,
        effort,
        plan,
        emittedByItem: new Map(),
      }
      this.sessions.set(key, state)
    } else {
      const thread = this.getCodex().startThread(options)
      const hasPrior = Boolean(ctx.previousTranscript?.length)
      seedTranscript =
        forceTranscriptFallback ||
        (configChanged && hasPrior) ||
        Boolean(recovery?.preferTranscriptFallback && hasPrior)
      this.recovery.delete(key)
      state = {
        thread,
        codexThreadId: recovery?.codexThreadId ?? existing?.codexThreadId ?? null,
        model: baseModel,
        effort,
        plan,
        emittedByItem: new Map(),
      }
      this.sessions.set(key, state)
    }

    const thread = state.thread

    const prompt = buildAgentPrompt(
      ctx.text,
      plan,
      seedTranscript && ctx.previousTranscript?.length ? ctx.previousTranscript : undefined,
      'codex',
    )

    try {
      const { events } = await thread.runStreamed(prompt, { signal: ctx.signal })
      try {
        for await (const event of events) {
          this.handleEvent(ctx, state, event)
        }
      } catch (err) {
        if (!isBenignCodexInterruptError(err, ctx.signal)) throw err
      }
    } catch (err) {
      if (!isBenignCodexInterruptError(err, ctx.signal) && isStaleCodexThreadError(err)) {
        this.sessions.delete(key)
      }
      if (!isBenignCodexInterruptError(err, ctx.signal)) throw err
    } finally {
      if (ctx.signal.aborted) {
        this.markSessionInterrupted(key)
      }
    }
  }

  private emitAgentMessageText(
    ctx: AgentTurnContext,
    state: CodexSessionState,
    itemId: string,
    text: string,
  ): void {
    const prev = state.emittedByItem.get(itemId) ?? ''
    const { delta, emitted } = computeTextDelta(prev, text)
    if (delta) {
      state.emittedByItem.set(itemId, emitted)
      ctx.emit(evAssistantDelta(ctx.sessionRef, delta))
    }
  }

  private handleEvent(ctx: AgentTurnContext, state: CodexSessionState, event: ThreadEvent): void {
    switch (event.type) {
      case 'thread.started':
        state.codexThreadId = event.thread_id
        break
      case 'item.started': {
        const item = event.item
        if (item.type === 'agent_message') {
          this.emitAgentMessageText(ctx, state, item.id, item.text ?? '')
        } else if (item.type === 'reasoning') {
          this.emitAgentMessageText(ctx, state, item.id, item.text ?? '')
        }
        const descriptor = toolDescriptor(item)
        if (descriptor) {
          ctx.emit(evToolStarted(ctx.sessionRef, item.id, descriptor.toolName, descriptor.input))
        }
        break
      }
      case 'item.updated':
      case 'item.completed': {
        const item = event.item
        if (item.type === 'agent_message' || item.type === 'reasoning') {
          this.emitAgentMessageText(ctx, state, item.id, item.text ?? '')
          break
        }
        if (item.type === 'todo_list') {
          ctx.emit(evToolStarted(ctx.sessionRef, item.id, 'todowrite', item.items))
          if (event.type === 'item.completed') {
            ctx.emit(evToolFinished(ctx.sessionRef, item.id, true, item.items))
          }
          break
        }
        if (item.type === 'command_execution') {
          if (event.type === 'item.updated' && item.status === 'in_progress') {
            const streamed = item.aggregated_output?.trim()
            if (streamed) {
              ctx.emit(evToolUpdated(ctx.sessionRef, item.id, truncateShellOutput(streamed)))
            }
          }
          const terminal = item.status === 'completed' || item.status === 'failed'
          if (terminal) {
            ctx.emit(evToolFinished(ctx.sessionRef, item.id, toolSucceeded(item), summarizeItem(item)))
          }
          break
        }
        if (event.type === 'item.completed') {
          const descriptor = toolDescriptor(item)
          if (descriptor) {
            ctx.emit(evToolFinished(ctx.sessionRef, item.id, toolSucceeded(item), summarizeItem(item)))
          }
        }
        break
      }
      case 'turn.failed':
        throw new Error(event.error?.message ?? 'Codex turn failed')
      case 'error':
        throw new Error(event.message ?? 'Codex error')
      default:
        break
    }
  }
}

const MAX_SHELL_STREAM_CHARS = 8_000

function truncateShellOutput(text: string): string {
  if (text.length <= MAX_SHELL_STREAM_CHARS) return text
  return text.slice(-MAX_SHELL_STREAM_CHARS)
}

function summarizeItem(item: ThreadItem): unknown {
  switch (item.type) {
    case 'command_execution':
      return item.aggregated_output
    case 'mcp_tool_call':
      return item.result ?? item.error
    case 'file_change':
      return item.changes
    case 'todo_list':
      return item.items
    default:
      return undefined
  }
}
