import { execFileSync } from 'node:child_process'
import {
  Codex,
  type ModelReasoningEffort,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
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
  model: string
  effort: ModelReasoningEffort
  plan: boolean
  /** agent_message item id → text already streamed, for delta computation. */
  readonly emittedByItem: Map<string, string>
}

/** Maps a Codex thread item to a tool label + input, or null for non-tool items. */
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

export class CodexDriver implements AgentDriver {
  readonly provider = 'codex' as const
  private codex: Codex | null = null
  private readonly sessions = new Map<string, CodexSessionState>()

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
    const key = ctx.sessionRef.sessionId
    const baseModel = parseModelEffort(ctx.model).base
    const effort = mapThinkingLevelToCodexEffort(ctx.thinkingLevel)
    let state = this.sessions.get(key)
    // The Codex thread fixes model + effort + sandbox at creation, so recreate when any change.
    if (!state || state.model !== baseModel || state.effort !== effort || state.plan !== ctx.plan) {
      const thread = this.getCodex().startThread({
        model: baseModel,
        modelReasoningEffort: effort,
        workingDirectory: ctx.workspacePath,
        skipGitRepoCheck: true,
        ...(ctx.plan ? { sandboxMode: 'read-only' as const } : {}),
      })
      state = { thread, model: baseModel, effort, plan: ctx.plan, emittedByItem: new Map() }
      this.sessions.set(key, state)
    }

    const prompt = buildAgentPrompt(ctx.text, ctx.plan)
    const { events } = await state.thread.runStreamed(prompt, { signal: ctx.signal })
    for await (const event of events) {
      this.handleEvent(ctx, state, event)
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
      case 'item.started': {
        const item = event.item
        if (item.type === 'agent_message') {
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
        if (item.type === 'agent_message') {
          this.emitAgentMessageText(ctx, state, item.id, item.text ?? '')
          break
        }
        // Re-emit the running todo list so the checklist card reflects each update,
        // since toolFinished alone carries no input payload.
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

  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
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
