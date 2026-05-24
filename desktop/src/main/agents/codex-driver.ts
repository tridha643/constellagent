/**
 * Codex Conductor driver — maps `@openai/codex-sdk` thread items to the shared timeline.
 *
 * Delegated subagent runs arrive as runtime `collab_tool_call` JSONL items (spawn_agent / wait)
 * even when the published SDK `ThreadItem` union omits them; see `codex-driver-collab.ts`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Codex,
  type Input,
  type ModelReasoningEffort,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
} from '@openai/codex-sdk'
import { checkCodexAuth, getOpenaiApiKey } from '../conductor-auth'
import { getConductorCodexWebSocketsSetting } from '../conductor-settings'
import { cliEnvWithStandardPath } from '../cli-env'
import { logMainPerfEvent } from '../perf'
import { mapThinkingLevelToCodexEffort, parseModelEffort } from '../../shared/conductor-model-utils'
import type { CodexWebSocketsSetting } from '../../shared/codex-websockets'
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
import type { ConductorImageAttachment } from '../../shared/conductor-attachments'
import { codexConductorThreadPermissions } from './conductor-sdk-cli-permissions'
import { isCollabToolCallItem } from '../../shared/codex-collab-types'
import {
  clearCodexCollabSessionState,
  createCodexCollabSessionState,
  handleCodexCollabItem,
  type CodexCollabSessionState,
} from './codex-driver-collab'

interface CodexSessionState {
  thread: Thread
  /** From `thread.started` — used with `resumeThread()` if the in-memory Thread is lost. */
  codexThreadId: string | null
  model: string
  effort: ModelReasoningEffort
  plan: boolean
  webSocketsEnabled: boolean
  readonly emittedByItem: Map<string, string>
  readonly lastToolUpdateByItem: Map<string, { text: string; emittedAt: number }>
  readonly collab: CodexCollabSessionState
}

interface CodexContextUsage {
  usedTokens: number
  updatedAt: number
}

interface CodexSessionRecovery {
  codexThreadId: string | null
  model: string
  effort: ModelReasoningEffort
  plan: boolean
  webSocketsEnabled: boolean
  /** After user interrupt or stale resume — next turn seeds Conductor transcript instead of CLI resume. */
  preferTranscriptFallback: boolean
}

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject
type CodexConfigObject = { [key: string]: CodexConfigValue }

const CODEX_IMAGE_EXTENSION_BY_MIME: Record<ConductorImageAttachment['mimeType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export function buildCodexUserInput(prompt: string, imagePaths: readonly string[]): Input {
  if (imagePaths.length === 0) return prompt
  return [
    { type: 'text', text: prompt },
    ...imagePaths.map((path) => ({ type: 'local_image' as const, path })),
  ]
}

async function writeCodexImageAttachments(
  attachments: readonly ConductorImageAttachment[] | undefined,
): Promise<{ inputPaths: string[]; tempDir?: string }> {
  if (!attachments?.length) return { inputPaths: [] }
  const tempDir = await mkdtemp(join(tmpdir(), 'constellagent-codex-images-'))
  const inputPaths = await Promise.all(
    attachments.map(async (attachment, index) => {
      const extension = CODEX_IMAGE_EXTENSION_BY_MIME[attachment.mimeType]
      const filePath = join(tempDir, `${index + 1}-${attachment.id}.${extension}`)
      await writeFile(filePath, Buffer.from(attachment.data, 'base64'))
      return filePath
    }),
  )
  return { inputPaths, tempDir }
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
export function resolveCodexCliPath(): string | undefined {
  const env = cliEnvWithStandardPath()
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = [
    'codex',
    join(homedir(), '.local', 'bin', executable),
    join(homedir(), '.npm-global', 'bin', executable),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ]
  for (const candidate of candidates) {
    if (candidate !== 'codex' && existsSync(candidate)) return candidate
    try {
      const lookup = process.platform === 'win32' ? 'where' : 'which'
      const out = execFileSync(lookup, [candidate], { encoding: 'utf8', env, timeout: 5000 })
      const line = out.trim().split(/\r?\n/)[0]?.trim()
      if (line) return line
    } catch {
      // try next candidate
    }
  }
  return undefined
}

export function codexSdkEnv(): Record<string, string> {
  const env = cliEnvWithStandardPath()
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export function codexSdkModelForConductorModel(model: string): string {
  const { base, speedSuffix } = parseModelEffort(model)
  return speedSuffix === 'fast' ? `${base}-fast` : base
}

export function isCodexWebSocketsEligibleModel(model: string): boolean {
  const sdkModel = codexSdkModelForConductorModel(model).toLowerCase()
  return sdkModel.includes('codex')
}

export function shouldUseCodexWebSockets(setting: CodexWebSocketsSetting, model: string): boolean {
  return setting === 'auto' && isCodexWebSocketsEligibleModel(model)
}

export function codexConfigForWebSockets(webSocketsEnabled: boolean): CodexConfigObject | undefined {
  if (!webSocketsEnabled) return undefined
  return {
    model_providers: {
      openai: {
        supports_websockets: true,
      },
    },
  }
}

function threadOptionsForTurn(ctx: AgentTurnContext): ThreadOptions {
  const sdkModel = codexSdkModelForConductorModel(ctx.model)
  const effort = mapThinkingLevelToCodexEffort(ctx.thinkingLevel)
  return {
    model: sdkModel,
    modelReasoningEffort: effort,
    workingDirectory: ctx.workspacePath,
    skipGitRepoCheck: true,
    ...codexConductorThreadPermissions(ctx.plan),
  }
}

function configMatches(
  state: CodexSessionState | CodexSessionRecovery,
  model: string,
  effort: ModelReasoningEffort,
  plan: boolean,
  webSocketsEnabled: boolean,
): boolean {
  return (
    state.model === model &&
    state.effort === effort &&
    state.plan === plan &&
    state.webSocketsEnabled === webSocketsEnabled
  )
}

export class CodexDriver implements AgentDriver {
  readonly provider = 'codex' as const
  private codex: { client: Codex; webSocketsEnabled: boolean } | null = null
  private readonly sessions = new Map<string, CodexSessionState>()
  private readonly recovery = new Map<string, CodexSessionRecovery>()
  private readonly contextUsage = new Map<string, CodexContextUsage>()

  private getCodex(webSocketsEnabled: boolean): Codex {
    if (!this.codex || this.codex.webSocketsEnabled !== webSocketsEnabled) {
      const codexPathOverride = resolveCodexCliPath()
      const config = codexConfigForWebSockets(webSocketsEnabled)
      const client = new Codex({
        ...(getOpenaiApiKey() ? { apiKey: getOpenaiApiKey() } : {}),
        env: codexSdkEnv(),
        ...(codexPathOverride ? { codexPathOverride } : {}),
        ...(config ? { config } : {}),
      })
      this.codex = { client, webSocketsEnabled }
    }
    return this.codex.client
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
        webSocketsEnabled: state.webSocketsEnabled,
        preferTranscriptFallback: true,
      })
    }
    this.sessions.delete(sessionId)
  }

  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.recovery.delete(sessionId)
    this.contextUsage.delete(sessionId)
  }

  getContextUsage(sessionId: string): number | null {
    return this.contextUsage.get(sessionId)?.usedTokens ?? null
  }

  private async runTurnOnce(ctx: AgentTurnContext, forceTranscriptFallback: boolean): Promise<void> {
    const key = ctx.sessionRef.sessionId
    const options = threadOptionsForTurn(ctx)
    const baseModel = options.model!
    const effort = options.modelReasoningEffort!
    const plan = ctx.plan
    const webSocketsEnabled = shouldUseCodexWebSockets(
      getConductorCodexWebSocketsSetting(),
      baseModel,
    )

    const existing = this.sessions.get(key)
    const recovery = this.recovery.get(key)
    const configChanged =
      (existing && !configMatches(existing, baseModel, effort, plan, webSocketsEnabled)) ||
      (recovery && !configMatches(recovery, baseModel, effort, plan, webSocketsEnabled))

    let state: CodexSessionState
    let seedTranscript = forceTranscriptFallback

    if (existing && !configChanged && !forceTranscriptFallback) {
      // SDK primary path: same Thread instance, repeated runStreamed (see sdk/typescript/README.md).
      state = existing
      existing.emittedByItem.clear()
      clearCodexCollabSessionState(existing.collab)
    } else if (!forceTranscriptFallback && !configChanged && recovery?.codexThreadId && !recovery.preferTranscriptFallback) {
      // In-memory Thread lost but persisted session may still be resumable (~/.codex/sessions).
      const thread = this.getCodex(webSocketsEnabled).resumeThread(recovery.codexThreadId, options)
      this.recovery.delete(key)
      state = {
        thread,
        codexThreadId: recovery.codexThreadId,
        model: baseModel,
        effort,
        plan,
        webSocketsEnabled,
        emittedByItem: new Map(),
        lastToolUpdateByItem: new Map(),
        collab: createCodexCollabSessionState(),
      }
      this.sessions.set(key, state)
    } else if (!forceTranscriptFallback && !configChanged && recovery?.codexThreadId && recovery.preferTranscriptFallback) {
      // Interrupted prior turn — do not resume a broken rollout; seed transcript on a fresh thread.
      const thread = this.getCodex(webSocketsEnabled).startThread(options)
      seedTranscript = Boolean(ctx.previousTranscript?.length)
      this.recovery.delete(key)
      state = {
        thread,
        codexThreadId: null,
        model: baseModel,
        effort,
        plan,
        webSocketsEnabled,
        emittedByItem: new Map(),
        lastToolUpdateByItem: new Map(),
        collab: createCodexCollabSessionState(),
      }
      this.sessions.set(key, state)
    } else {
      const thread = this.getCodex(webSocketsEnabled).startThread(options)
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
        webSocketsEnabled,
        emittedByItem: new Map(),
        lastToolUpdateByItem: new Map(),
        collab: createCodexCollabSessionState(),
      }
      this.sessions.set(key, state)
    }

    const thread = state.thread
    state.lastToolUpdateByItem.clear()

    const prompt = buildAgentPrompt(
      ctx.text,
      plan,
      seedTranscript && ctx.previousTranscript?.length ? ctx.previousTranscript : undefined,
      'codex',
      ctx.canvas,
    )
    const imageInput = await writeCodexImageAttachments(ctx.attachments)
    const input = buildCodexUserInput(prompt, imageInput.inputPaths)
    const turnOptions = { signal: ctx.signal }

    try {
      const runStreamedStartedAt = performance.now()
      const { events } = await thread.runStreamed(input, turnOptions)
      logMainPerfEvent('codex.runStreamed_ready', performance.now() - runStreamedStartedAt, {
        model: baseModel,
        effort,
        seedTranscript,
        webSocketsEnabled,
      })
      try {
        let firstEventAt: number | undefined
        let eventCount = 0
        for await (const event of events) {
          eventCount += 1
          if (firstEventAt === undefined) {
            firstEventAt = performance.now()
            logMainPerfEvent('codex.runStreamed_first_event', firstEventAt - runStreamedStartedAt, {
              model: baseModel,
              effort,
              eventType: event.type,
              webSocketsEnabled,
            })
          }
          this.handleEvent(ctx, state, event)
        }
        logMainPerfEvent('codex.runStreamed_events_total', performance.now() - runStreamedStartedAt, {
          model: baseModel,
          effort,
          eventCount,
          webSocketsEnabled,
        })
      } catch (err) {
        if (!isBenignCodexInterruptError(err, ctx.signal)) throw err
      }
    } catch (err) {
      if (!isBenignCodexInterruptError(err, ctx.signal) && isStaleCodexThreadError(err)) {
        this.sessions.delete(key)
      }
      if (!isBenignCodexInterruptError(err, ctx.signal)) throw err
    } finally {
      if (imageInput.tempDir) {
        await rm(imageInput.tempDir, { recursive: true, force: true }).catch(() => {})
      }
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
      case 'turn.completed': {
        const usedTokens =
          event.usage.input_tokens +
          event.usage.cached_input_tokens
        this.contextUsage.set(ctx.sessionRef.sessionId, {
          usedTokens,
          updatedAt: Date.now(),
        })
        break
      }
      case 'item.started': {
        const item = event.item
        if (isCollabToolCallItem(item)) {
          handleCodexCollabItem(ctx, state.collab, state.lastToolUpdateByItem, event.type, item)
          break
        }
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
        if (isCollabToolCallItem(item)) {
          handleCodexCollabItem(ctx, state.collab, state.lastToolUpdateByItem, event.type, item)
          break
        }
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
            if (streamed && shouldEmitToolUpdate(state, item.id, truncateShellOutput(streamed))) {
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
const TOOL_UPDATE_MIN_INTERVAL_MS = 120

function shouldEmitToolUpdate(state: CodexSessionState, itemId: string, text: string): boolean {
  const previous = state.lastToolUpdateByItem.get(itemId)
  const now = performance.now()
  if (!previous) {
    state.lastToolUpdateByItem.set(itemId, { text, emittedAt: now })
    return true
  }
  if (previous.text === text) {
    return false
  }
  if (now - previous.emittedAt < TOOL_UPDATE_MIN_INTERVAL_MS) {
    return false
  }
  state.lastToolUpdateByItem.set(itemId, { text, emittedAt: now })
  return true
}

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
