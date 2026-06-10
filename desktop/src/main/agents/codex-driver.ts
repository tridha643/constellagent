/**
 * Codex Conductor driver — maps `codex app-server` notifications to the shared timeline.
 *
 * Delegated subagent runs arrive as `collab_tool_call` items (spawn_agent / wait); see `codex-driver-collab.ts`.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ModelReasoningEffort,
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
  evAssistantDelta,
  evToolFinished,
  evToolStarted,
  evToolUpdated,
  buildAgentPrompt,
  computeTextDelta,
  promptEmitsFormatPrefix,
  type AgentDriver,
  type AgentCompactContext,
  type AgentTurnContext,
} from './agent-driver'
import type { ConductorImageAttachment } from '../../shared/conductor-attachments'
import type { TranscriptMessage } from '../../shared/pi/pi-desktop-state'
import { codexConductorThreadPermissions } from './conductor-sdk-cli-permissions'
import { isCollabToolCallItem } from '../../shared/codex-collab-types'
import {
  clearCodexCollabSessionState,
  createCodexCollabSessionState,
  handleCodexCollabItem,
  type CodexCollabSessionState,
} from './codex-driver-collab'
import {
  AGENT_SDK_HOOK_CAPABILITIES,
  applyAgentSdkToolHook,
  type AgentSdkToolEmission,
  type AgentSdkToolHookResult,
} from './agent-sdk-hooks'
import {
  formatAppServerRequestUserInputResult,
  parseAppServerRequestUserInput,
} from './codex-ask-user'
import {
  buildCodexCollaborationMode,
  isCollaborationModeUnsupportedError,
} from './codex-collaboration-mode'
import { getConductorQuestionBridge } from './conductor-question-bridge'
import {
  buildCodexAppServerConfigArgs,
  CodexAppServerClient,
} from './codex-app-server-client'
import {
  createCodexAppServerEventMapperState,
  mapAppServerNotification,
  type CodexAppServerEventMapperState,
} from './codex-app-server-events'
import { SkillsService } from '../skills-service'

interface CodexThreadHandle {
  readonly threadId: string
}

interface CodexSessionState {
  thread: CodexThreadHandle
  /** From `thread.started` — used with `thread/resume` if the in-memory handle is lost. */
  codexThreadId: string | null
  activeTurnId: string | null
  model: string
  effort: ModelReasoningEffort
  plan: boolean
  webSocketsEnabled: boolean
  /** True once this thread has received the markdown formatting prefix; skip re-sending it on later turns. */
  formatPrimed: boolean
  readonly emittedByItem: Map<string, string>
  readonly lastToolUpdateByItem: Map<string, { text: string; emittedAt: number }>
  readonly collab: CodexCollabSessionState
}

interface CodexActiveTurnContext {
  readonly ctx: AgentTurnContext
  readonly state: CodexSessionState
  readonly mapper: CodexAppServerEventMapperState
  readonly completion: TurnCompletionGate
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

export interface CodexToolHookEvent {
  readonly provider: 'codex'
  readonly phase: 'started' | 'updated' | 'finished'
  readonly callId: string
  readonly toolName: string
  readonly item: ThreadItem
  readonly raw: ThreadItem
  readonly workspacePath: string
  readonly sessionRef: AgentTurnContext['sessionRef']
  readonly input?: unknown
  readonly output?: unknown
  readonly success?: boolean
  readonly capabilities: typeof AGENT_SDK_HOOK_CAPABILITIES
}

export type CodexToolHookResult = AgentSdkToolHookResult

export type CodexToolHook = (event: CodexToolHookEvent) => CodexToolHookResult | void

export interface CodexDriverHooks {
  readonly onToolEvent?: CodexToolHook
}

const CODEX_IMAGE_EXTENSION_BY_MIME: Record<ConductorImageAttachment['mimeType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export interface CodexAppServerTurnInput {
  readonly type: 'text' | 'localImage'
  readonly text?: string
  readonly path?: string
}

export function buildCodexUserInput(prompt: string, imagePaths: readonly string[]): CodexAppServerTurnInput[] {
  if (imagePaths.length === 0) return [{ type: 'text', text: prompt }]
  return [
    { type: 'text', text: prompt },
    ...imagePaths.map((path) => ({ type: 'localImage' as const, path })),
  ]
}

export function shouldSeedFreshCodexThread(
  forceTranscriptFallback: boolean,
  previousTranscript?: readonly TranscriptMessage[],
): boolean {
  return forceTranscriptFallback || Boolean(previousTranscript?.length)
}

export function applyCodexToolHook(
  event: CodexToolHookEvent,
  hook?: CodexToolHook,
): AgentSdkToolEmission | null {
  return applyAgentSdkToolHook(event, hook)
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

/** True when `codex exec` accepts the SDK's `--experimental-json` flag (not just `--json`). */
export function codexCliSupportsSdkExec(codexPath: string, env: NodeJS.ProcessEnv): boolean {
  const result = spawnSync(codexPath, ['exec', '--experimental-json'], {
    encoding: 'utf8',
    env,
    input: '',
    timeout: 5000,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (output.includes("unexpected argument '--experimental-json'")) {
    return false
  }
  return result.error == null
}

let resolvedCodexCliPath: string | undefined | null = null

/** Prefer newer/user-managed Codex installs over stale Homebrew shims that break the SDK. */
export function resolveCodexCliPath(): string | undefined {
  if (resolvedCodexCliPath !== null) {
    return resolvedCodexCliPath || undefined
  }
  const env = cliEnvWithStandardPath()
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = [
    join(homedir(), '.bun', 'bin', executable),
    join(homedir(), '.local', 'bin', executable),
    join(homedir(), '.npm-global', 'bin', executable),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    if (codexCliSupportsSdkExec(candidate, env)) {
      resolvedCodexCliPath = candidate
      return candidate
    }
  }
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(lookup, ['codex'], { encoding: 'utf8', env, timeout: 5000 })
    const line = out.trim().split(/\r?\n/)[0]?.trim()
    if (line && codexCliSupportsSdkExec(line, env)) {
      resolvedCodexCliPath = line
      return line
    }
  } catch {
    // fall through
  }
  resolvedCodexCliPath = undefined
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

export function codexConfigForWebSockets(webSocketsEnabled: boolean): CodexConfigObject {
  return {
    features: {
      default_mode_request_user_input: true,
    },
    ...(webSocketsEnabled
      ? {
          model_providers: {
            openai: {
              supports_websockets: true,
            },
          },
        }
      : {}),
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

class TurnCompletionGate {
  private completed = false
  private failed: Error | null = null
  private readonly waiters: Array<() => void> = []

  markCompleted(): void {
    if (this.completed || this.failed) return
    this.completed = true
    this.flush()
  }

  markFailed(error: Error): void {
    if (this.completed || this.failed) return
    this.failed = error
    this.flush()
  }

  async wait(signal: AbortSignal): Promise<void> {
    if (this.completed) return
    if (this.failed) throw this.failed
    if (signal.aborted) return
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup()
        resolve()
      }
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort)
        const index = this.waiters.indexOf(onResolve)
        if (index >= 0) this.waiters.splice(index, 1)
      }
      const onResolve = () => {
        cleanup()
        if (this.failed) {
          reject(this.failed)
          return
        }
        resolve()
      }
      this.waiters.push(onResolve)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    if (this.failed) throw this.failed
  }

  private flush(): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter()
    }
  }
}

export class CodexDriver implements AgentDriver {
  readonly provider = 'codex' as const
  private appServer: { client: CodexAppServerClient; webSocketsEnabled: boolean } | null = null
  private activeTurn: CodexActiveTurnContext | null = null
  private readonly sessions = new Map<string, CodexSessionState>()
  private readonly recovery = new Map<string, CodexSessionRecovery>()
  private readonly contextUsage = new Map<string, CodexContextUsage>()

  constructor(private readonly hooks: CodexDriverHooks = {}) {}

  private async getAppServerClient(webSocketsEnabled: boolean): Promise<CodexAppServerClient> {
    if (!this.appServer || this.appServer.webSocketsEnabled !== webSocketsEnabled) {
      this.appServer?.client.dispose()
      const codexPath = resolveCodexCliPath()
      if (!codexPath) {
        throw new Error('Codex CLI not found. Install Codex and ensure it supports app-server.')
      }
      const client = new CodexAppServerClient({
        codexPath,
        env: {
          ...codexSdkEnv(),
          ...(getOpenaiApiKey() ? { OPENAI_API_KEY: getOpenaiApiKey()! } : {}),
        },
        configArgs: buildCodexAppServerConfigArgs(webSocketsEnabled),
        onNotification: (method, params) => this.handleAppServerNotification(method, params),
        onServerRequest: (method, id, params) => this.handleAppServerServerRequest(method, id, params),
      })
      this.appServer = { client, webSocketsEnabled }
    }
    await this.appServer.client.ensureReady()
    return this.appServer.client
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
        codexThreadId: state.codexThreadId ?? state.thread.threadId,
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

  async compactSession(ctx: AgentCompactContext): Promise<void> {
    const key = ctx.sessionRef.sessionId
    const state = this.sessions.get(key)
    if (state) {
      const client = await this.getAppServerClient(state.webSocketsEnabled)
      await client.request('thread/compact/start', {
        threadId: state.thread.threadId,
        ...(ctx.customInstructions?.trim() ? { customInstructions: ctx.customInstructions.trim() } : {}),
      })
      this.contextUsage.delete(key)
      return
    }
    this.sessions.delete(key)
    this.recovery.delete(key)
    this.contextUsage.delete(key)
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

    const client = await this.getAppServerClient(webSocketsEnabled)

    if (existing && !configChanged && !forceTranscriptFallback) {
      state = existing
      existing.emittedByItem.clear()
      existing.activeTurnId = null
      clearCodexCollabSessionState(existing.collab)
    } else if (!forceTranscriptFallback && !configChanged && recovery?.codexThreadId && !recovery.preferTranscriptFallback) {
      await client.request('thread/resume', threadResumeParams(recovery.codexThreadId, options))
      this.recovery.delete(key)
      state = {
        thread: { threadId: recovery.codexThreadId },
        codexThreadId: recovery.codexThreadId,
        activeTurnId: null,
        model: baseModel,
        effort,
        plan,
        webSocketsEnabled,
        formatPrimed: true,
        emittedByItem: new Map(),
        lastToolUpdateByItem: new Map(),
        collab: createCodexCollabSessionState(),
      }
      this.sessions.set(key, state)
    } else if (!forceTranscriptFallback && !configChanged && recovery?.codexThreadId && recovery.preferTranscriptFallback) {
      const threadId = await startAppServerThread(client, options)
      seedTranscript = Boolean(ctx.previousTranscript?.length)
      this.recovery.delete(key)
      state = {
        thread: { threadId },
        codexThreadId: threadId,
        activeTurnId: null,
        model: baseModel,
        effort,
        plan,
        webSocketsEnabled,
        formatPrimed: false,
        emittedByItem: new Map(),
        lastToolUpdateByItem: new Map(),
        collab: createCodexCollabSessionState(),
      }
      this.sessions.set(key, state)
    } else {
      const threadId = await startAppServerThread(client, options)
      seedTranscript = shouldSeedFreshCodexThread(forceTranscriptFallback, ctx.previousTranscript)
      this.recovery.delete(key)
      state = {
        thread: { threadId },
        codexThreadId: threadId,
        activeTurnId: null,
        model: baseModel,
        effort,
        plan,
        webSocketsEnabled,
        formatPrimed: false,
        emittedByItem: new Map(),
        lastToolUpdateByItem: new Map(),
        collab: createCodexCollabSessionState(),
      }
      this.sessions.set(key, state)
    }

    state.lastToolUpdateByItem.clear()

    // Send the markdown formatting prefix only on a thread's first turn; it
    // persists in thread history thereafter (saves ~75 tokens every later turn).
    const includeFormatPrefix = !state.formatPrimed
    const skillExpansion = await SkillsService.expandSkillInvocation(
      ctx.text,
      'codex',
      ctx.workspacePath,
    )
    const prompt = buildAgentPrompt(
      skillExpansion.text,
      plan,
      seedTranscript && ctx.previousTranscript?.length ? ctx.previousTranscript : undefined,
      'codex',
      ctx.canvas,
      includeFormatPrefix,
      skillExpansion.isSkillInvocation,
    )
    if (
      promptEmitsFormatPrefix(
        skillExpansion.text,
        'codex',
        ctx.canvas,
        includeFormatPrefix,
        skillExpansion.isSkillInvocation,
      )
    ) {
      state.formatPrimed = true
    }
    const imageInput = await writeCodexImageAttachments(ctx.attachments)
    let input = buildCodexUserInput(prompt, imageInput.inputPaths)

    try {
      state.emittedByItem.clear()
      await this.runCodexAppServerTurn(ctx, state, client, input, {
        model: baseModel,
        effort,
        seedTranscript,
        webSocketsEnabled,
      })
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

  private async runCodexAppServerTurn(
    ctx: AgentTurnContext,
    state: CodexSessionState,
    client: CodexAppServerClient,
    input: CodexAppServerTurnInput[],
    logContext: {
      readonly model: string
      readonly effort: ModelReasoningEffort
      readonly seedTranscript: boolean
      readonly webSocketsEnabled: boolean
    },
  ): Promise<void> {
    const turnStartedAt = performance.now()
    const mapper = createCodexAppServerEventMapperState()
    const completion = new TurnCompletionGate()
    this.activeTurn = { ctx, state, mapper, completion }

    const abortHandler = () => {
      const turnId = state.activeTurnId
      if (!turnId) return
      void client.request('turn/interrupt', {
        threadId: state.thread.threadId,
        turnId,
      }).catch(() => {})
    }
    ctx.signal.addEventListener('abort', abortHandler)

    try {
      const baseParams = {
        threadId: state.thread.threadId,
        input,
        effort: logContext.effort,
        model: logContext.model,
      }
      try {
        await client.request('turn/start', {
          ...baseParams,
          collaborationMode: buildCodexCollaborationMode(
            logContext.model,
            logContext.effort,
            state.plan,
          ),
        })
      } catch (err) {
        if (!isCollaborationModeUnsupportedError(err)) throw err
        await client.request('turn/start', baseParams)
      }
      logMainPerfEvent('codex.appServer.turn_started', performance.now() - turnStartedAt, logContext)
      await completion.wait(ctx.signal)
      logMainPerfEvent('codex.appServer.turn_completed', performance.now() - turnStartedAt, logContext)
    } catch (err) {
      if (!isBenignCodexInterruptError(err, ctx.signal)) throw err
    } finally {
      ctx.signal.removeEventListener('abort', abortHandler)
      this.activeTurn = null
      state.activeTurnId = null
    }
  }

  private handleAppServerNotification(method: string, params: unknown): void {
    const activeTurn = this.activeTurn
    if (!activeTurn) return
    const events = mapAppServerNotification(method, params, activeTurn.mapper)
    for (const event of events) {
      if (event.type === 'turn.started') {
        activeTurn.state.activeTurnId = activeTurn.mapper.activeTurnId
      }
      this.handleEvent(activeTurn.ctx, activeTurn.state, event)
      if (event.type === 'turn.completed') {
        activeTurn.completion.markCompleted()
      }
      if (event.type === 'turn.failed' || event.type === 'error') {
        const message =
          event.type === 'turn.failed'
            ? event.error?.message ?? 'Codex turn failed'
            : event.message ?? 'Codex error'
        activeTurn.completion.markFailed(new Error(message))
      }
    }
  }

  private async handleAppServerServerRequest(
    method: string,
    _id: string | number,
    params: unknown,
  ): Promise<unknown> {
    if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') {
      return this.resolveAppServerRequestUserInput(params)
    }
    if (
      method === 'item/commandExecution/requestApproval'
      || method === 'item/fileChange/requestApproval'
      || method.endsWith('requestApproval')
    ) {
      return { decision: 'accept' }
    }
    throw new Error(`Unsupported Codex app-server request: ${method}`)
  }

  private async resolveAppServerRequestUserInput(params: unknown): Promise<unknown> {
    const activeTurn = this.activeTurn
    if (!activeTurn) {
      return { answers: {} }
    }
    const request = parseAppServerRequestUserInput(params)
    if (!request) {
      return { answers: {} }
    }
    const itemId =
      typeof (params as { itemId?: unknown })?.itemId === 'string'
        ? (params as { itemId: string }).itemId
        : 'request-user-input'
    const callId = `codex-ask-user:${itemId}`
    const { ctx, state } = activeTurn
    ctx.emit(evToolStarted(ctx.sessionRef, callId, 'AskQuestion', { questions: request.questions }))
    try {
      const details = await getConductorQuestionBridge().registerPending({
        sessionId: ctx.sessionRef.sessionId,
        callId,
        provider: 'codex',
        source: 'askQuestion',
        questions: request.questions,
      })
      const result = formatAppServerRequestUserInputResult(details, request.questionIds)
      ctx.emit(evToolFinished(ctx.sessionRef, callId, !details.cancelled, details))
      return result
    } catch (err) {
      ctx.emit(evToolFinished(ctx.sessionRef, callId, false, undefined))
      if (isBenignCodexInterruptError(err, ctx.signal)) {
        return { answers: {} }
      }
      throw err
    } finally {
      state.activeTurnId = state.activeTurnId ?? activeTurn.mapper.activeTurnId
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

  private emitToolStarted(
    ctx: AgentTurnContext,
    item: ThreadItem,
    toolName: string,
    input?: unknown,
  ): void {
    const emission = applyCodexToolHook(
      {
        provider: 'codex',
        phase: 'started',
        callId: item.id,
        toolName,
        item,
        raw: item,
        workspacePath: ctx.workspacePath,
        sessionRef: ctx.sessionRef,
        input,
        capabilities: AGENT_SDK_HOOK_CAPABILITIES,
      },
      this.hooks.onToolEvent,
    )
    if (!emission) return
    ctx.emit(evToolStarted(ctx.sessionRef, item.id, emission.toolName, emission.input))
  }

  private emitToolUpdated(
    ctx: AgentTurnContext,
    item: ThreadItem,
    toolName: string,
    output?: unknown,
  ): void {
    const emission = applyCodexToolHook(
      {
        provider: 'codex',
        phase: 'updated',
        callId: item.id,
        toolName,
        item,
        raw: item,
        workspacePath: ctx.workspacePath,
        sessionRef: ctx.sessionRef,
        output,
        capabilities: AGENT_SDK_HOOK_CAPABILITIES,
      },
      this.hooks.onToolEvent,
    )
    if (!emission) return
    ctx.emit(evToolUpdated(ctx.sessionRef, item.id, String(emission.output ?? '')))
  }

  private emitToolFinished(
    ctx: AgentTurnContext,
    item: ThreadItem,
    toolName: string,
    success: boolean,
    output?: unknown,
  ): void {
    const emission = applyCodexToolHook(
      {
        provider: 'codex',
        phase: 'finished',
        callId: item.id,
        toolName,
        item,
        raw: item,
        workspacePath: ctx.workspacePath,
        sessionRef: ctx.sessionRef,
        success,
        output,
        capabilities: AGENT_SDK_HOOK_CAPABILITIES,
      },
      this.hooks.onToolEvent,
    )
    if (!emission) return
    ctx.emit(evToolFinished(ctx.sessionRef, item.id, emission.success ?? success, emission.output))
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
          this.emitToolStarted(ctx, item, descriptor.toolName, descriptor.input)
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
          this.emitToolStarted(ctx, item, 'todowrite', item.items)
          if (event.type === 'item.completed') {
            this.emitToolFinished(ctx, item, 'todowrite', true, item.items)
          }
          break
        }
        if (item.type === 'command_execution') {
          if (event.type === 'item.updated' && item.status === 'in_progress') {
            const streamed = item.aggregated_output?.trim()
            if (streamed && shouldEmitToolUpdate(state, item.id, truncateShellOutput(streamed))) {
              this.emitToolUpdated(ctx, item, 'shell', truncateShellOutput(streamed))
            }
          }
          const terminal = item.status === 'completed' || item.status === 'failed'
          if (terminal) {
            this.emitToolFinished(ctx, item, 'shell', toolSucceeded(item), summarizeItem(item))
          }
          break
        }
        if (event.type === 'item.completed') {
          const descriptor = toolDescriptor(item)
          if (descriptor) {
            this.emitToolFinished(ctx, item, descriptor.toolName, toolSucceeded(item), summarizeItem(item))
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

async function startAppServerThread(
  client: CodexAppServerClient,
  options: ThreadOptions,
): Promise<string> {
  const result = await client.request<{ thread?: { id?: string } }>('thread/start', threadStartParams(options))
  const threadId = result.thread?.id
  if (!threadId) {
    throw new Error('Codex thread/start response missing thread id')
  }
  return threadId
}

function threadStartParams(options: ThreadOptions): Record<string, unknown> {
  return {
    ...(options.model ? { model: options.model } : {}),
    ...(options.workingDirectory ? { cwd: options.workingDirectory } : {}),
    ...(options.modelReasoningEffort ? { effort: options.modelReasoningEffort } : {}),
    ...(options.sandboxMode ? { sandbox: options.sandboxMode } : {}),
    ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
    ...(options.networkAccessEnabled === false ? { networkAccess: false } : {}),
  }
}

function threadResumeParams(threadId: string, options: ThreadOptions): Record<string, unknown> {
  return {
    threadId,
    ...(options.workingDirectory ? { cwd: options.workingDirectory } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.modelReasoningEffort ? { effort: options.modelReasoningEffort } : {}),
    ...(options.sandboxMode ? { sandbox: options.sandboxMode } : {}),
    ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
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
