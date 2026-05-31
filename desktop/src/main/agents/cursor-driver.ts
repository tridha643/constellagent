import '../cursor-sdk-ripgrep-config'
import '../cursor-sdk-interaction-config'
import {
  Agent,
  convertError,
  type InteractionUpdate,
  type Run,
  type SDKAgent,
  type SDKUserMessage,
  type SDKMessage,
  type TextBlock,
} from '@cursor/sdk'
import {
  getCursorModelCatalog,
  withCursorSdkModelValidationBypass,
} from '../cursor-model-catalog'
import { checkCursorAuth, getCursorApiKey, hasCursorCliLogin } from '../conductor-auth'
import {
  isCursorSdkModelValidationError,
  shouldBypassCursorSdkModelValidation,
} from '../../shared/cursor-sdk-model'
import {
  computeTextDelta,
  evAssistantDelta,
  evToolFinished,
  evToolStarted,
  evToolUpdated,
  buildAgentPrompt,
  promptEmitsFormatPrefix,
  type AgentDriver,
  type AgentTurnContext,
} from './agent-driver'
import { applyThinkingLevel } from '../../shared/conductor-model-utils'
import { isSubagentTool } from '../../shared/conductor-subagent-utils'
import {
  subagentInteractionEffect,
  subagentTaskMessageText,
} from './cursor-driver-deltas'
import { loadCursorSdkAgents } from './cursor-subagent-config'
import { createCursorAskQuestionHandler } from './cursor-interaction-bridge'
import { setCursorAskQuestionHandler } from './cursor-sdk-interaction-patch'
import { cursorConductorLocalPermissions } from './conductor-sdk-cli-permissions'
import type { ConductorComposerAttachment } from '../../shared/conductor-attachments'

interface CursorSessionState {
  agent: SDKAgent
  model: string
  plan: boolean
  /** True once this agent has received the markdown formatting prefix; skip re-sending it on later turns. */
  formatPrimed: boolean
  /** Assistant text streamed so far this turn, for delta computation. */
  emittedText: string
  run?: Run
  /** Active subagent tool_call id for progress/thinking/task milestone updates. */
  activeSubagentCallId?: string
}

/** gRPC/Connect "canceled" code — see connectrpc.com/docs/protocol#error-codes */
const CONNECT_CODE_CANCELED = 1
/** Connect "unknown" — often surfaced when a local agent stream is torn down mid-flight. */
const CONNECT_CODE_UNKNOWN = 2

export function connectErrorCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object' || !('code' in err)) return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === 'number' ? code : undefined
}

/** Connect abort/cancel rejections are expected when the user stops a run. */
export function isBenignCursorRunError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  if (connectErrorCode(err) === CONNECT_CODE_CANCELED) return true
  return false
}

/**
 * Detached Connect transport rejections (cancel/dispose/HMR) that never reach
 * our awaited handlers — safe to swallow in a process-level filter.
 */
export function isBenignConnectTransportError(err: unknown): boolean {
  const code = connectErrorCode(err)
  if (code === CONNECT_CODE_CANCELED || code === CONNECT_CODE_UNKNOWN) return true
  if (err instanceof Error && /\[unknown\]\s*Error/i.test(err.message)) return true
  return false
}

/** Map SDK / Connect failures to a user-facing Error for the Conductor timeline. */
export function toCursorUserError(err: unknown): Error {
  const converted = convertError(err)
  return converted instanceof Error ? converted : new Error(String(err))
}

async function disposeCursorAgent(agent: SDKAgent, run?: Run): Promise<void> {
  if (run?.supports('cancel')) {
    await run.cancel().catch(() => {})
  }
  if (run) {
    await run.wait().catch(() => {})
  }
  try {
    await agent[Symbol.asyncDispose]()
  } catch {
    try {
      agent.close()
    } catch {
      // best-effort
    }
  }
}

function detachCursorRun(run: Run): void {
  if (run.supports('cancel')) {
    void run.cancel().catch(() => {})
  }
  void run.wait().catch(() => {})
}

function cursorRunErrorMessage(raw: string | undefined): string {
  const detail = raw?.trim()
  if (detail && detail !== 'Cursor run error') return detail
  if (!getCursorApiKey() && !hasCursorCliLogin()) {
    return 'Cursor is not signed in. Run `cursor-agent login` in a terminal or add your API key in Settings -> Conductor.'
  }
  if (!getCursorApiKey()) {
    return 'Cursor local agent failed. Confirm `cursor-agent status` is authenticated, then try again.'
  }
  return detail || 'Cursor run failed'
}

async function createCursorSdkAgent(
  effectiveModel: string,
  ctx: AgentTurnContext,
  agents: NonNullable<Parameters<typeof Agent.create>[0]['agents']>,
): Promise<SDKAgent> {
  const apiKey = getCursorApiKey()
  const catalog = await getCursorModelCatalog()
  const bypassValidation = shouldBypassCursorSdkModelValidation(effectiveModel, {
    apiKey,
    hasCliLogin: hasCursorCliLogin(),
    catalog,
  })

  const buildOptions = (includeApiKey: boolean) => ({
    ...(includeApiKey && apiKey ? { apiKey } : {}),
    model: { id: effectiveModel },
    local: {
      cwd: ctx.workspacePath,
      settingSources: ['project' as const],
      ...cursorConductorLocalPermissions(ctx.plan),
    },
    ...(Object.keys(agents).length > 0 ? { agents } : {}),
  })

  try {
    return await withCursorSdkModelValidationBypass(bypassValidation, () =>
      Agent.create(buildOptions(true)),
    )
  } catch (err) {
    if (!bypassValidation && isCursorSdkModelValidationError(err) && hasCursorCliLogin()) {
      return withCursorSdkModelValidationBypass(true, () => Agent.create(buildOptions(true)))
    }
    throw err
  }
}

async function sendCursorSdkMessage(
  agent: SDKAgent,
  message: string | SDKUserMessage,
  effectiveModel: string,
  onDelta: (update: InteractionUpdate) => void,
): Promise<Run> {
  const apiKey = getCursorApiKey()
  const catalog = await getCursorModelCatalog()
  const bypassValidation = shouldBypassCursorSdkModelValidation(effectiveModel, {
    apiKey,
    hasCliLogin: hasCursorCliLogin(),
    catalog,
  })

  const sendOptions = {
    model: { id: effectiveModel },
    onDelta: ({ update }: { update: InteractionUpdate }) => {
      onDelta(update)
    },
  }

  try {
    return await withCursorSdkModelValidationBypass(bypassValidation, () => agent.send(message, sendOptions))
  } catch (err) {
    if (!bypassValidation && isCursorSdkModelValidationError(err) && hasCursorCliLogin()) {
      return withCursorSdkModelValidationBypass(true, () => agent.send(message, sendOptions))
    }
    throw err
  }
}

export function buildCursorUserMessage(
  text: string,
  attachments: readonly ConductorComposerAttachment[] | undefined,
): string | SDKUserMessage {
  const images = attachments
    ?.filter((attachment) => attachment.kind === 'image')
    .map((attachment) => ({ data: attachment.data, mimeType: attachment.mimeType }))
  if (!images?.length) return text
  return { text, images }
}

export class CursorDriver implements AgentDriver {
  readonly provider = 'cursor' as const
  private readonly sessions = new Map<string, CursorSessionState>()

  checkAuth(): string | null {
    return checkCursorAuth()
  }

  async runTurn(ctx: AgentTurnContext): Promise<void> {
    const key = ctx.sessionRef.sessionId
    const effectiveModel = applyThinkingLevel(ctx.model, ctx.thinkingLevel)
    let state = this.sessions.get(key)
    const needsNewAgent =
      !state || state.model !== effectiveModel || state.plan !== ctx.plan
    if (needsNewAgent) {
      if (state) {
        await disposeCursorAgent(state.agent, state.run).catch(() => {})
      }
      const agents = await loadCursorSdkAgents(ctx.workspacePath)
      let agent: SDKAgent
      try {
        agent = await createCursorSdkAgent(effectiveModel, ctx, agents)
      } catch (err) {
        throw toCursorUserError(err)
      }
      state = { agent, model: effectiveModel, plan: ctx.plan, formatPrimed: false, emittedText: '' }
      this.sessions.set(key, state)
    }
    if (!state) {
      throw new Error('Failed to create Cursor agent')
    }

    // Send the markdown formatting prefix only once per agent; it stays in the
    // agent's history afterwards, so continuation turns skip the ~75 tokens.
    const includeFormatPrefix = !state.formatPrimed
    const prompt = buildAgentPrompt(
      ctx.text,
      ctx.plan,
      needsNewAgent ? ctx.previousTranscript : undefined,
      'cursor',
      ctx.canvas,
      includeFormatPrefix,
    )
    if (promptEmitsFormatPrefix(ctx.text, 'cursor', ctx.canvas, includeFormatPrefix)) {
      state.formatPrimed = true
    }
    const message = buildCursorUserMessage(prompt, ctx.attachments)
    setCursorAskQuestionHandler(ctx.plan ? createCursorAskQuestionHandler(ctx) : null)
    let run: Run
    try {
      run = await sendCursorSdkMessage(state.agent, message, effectiveModel, (update) => {
        this.handleInteractionUpdate(ctx, state!, update)
      })
    } catch (err) {
      throw toCursorUserError(err)
    }
    state.run = run
    state.model = effectiveModel
    state.plan = ctx.plan
    state.emittedText = ''
    state.activeSubagentCallId = undefined

    const onAbort = (): void => {
      detachCursorRun(run)
    }
    ctx.signal.addEventListener('abort', onAbort)
    try {
      try {
        for await (const message of run.stream()) {
          this.handleMessage(ctx, state, message)
        }
      } catch (err) {
        if (!isBenignCursorRunError(err, ctx.signal)) {
          throw toCursorUserError(err)
        }
      }

      try {
        await run.wait()
      } catch (err) {
        if (!isBenignCursorRunError(err, ctx.signal)) {
          throw toCursorUserError(err)
        }
      }

      if (!ctx.signal.aborted && run.status === 'error') {
        throw new Error(cursorRunErrorMessage(run.result))
      }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
      setCursorAskQuestionHandler(null)
      state.run = undefined
      state.activeSubagentCallId = undefined
    }
  }

  private handleInteractionUpdate(
    ctx: AgentTurnContext,
    state: CursorSessionState,
    update: InteractionUpdate,
  ): void {
    const effect = subagentInteractionEffect(update, state.activeSubagentCallId)
    if (!effect) return
    if (effect.trackCall) {
      state.activeSubagentCallId = effect.callId
    }
    if (effect.text) {
      ctx.emit(evToolUpdated(ctx.sessionRef, effect.callId, effect.text))
    }
  }

  private handleMessage(ctx: AgentTurnContext, state: CursorSessionState, message: SDKMessage): void {
    switch (message.type) {
      case 'assistant': {
        const text = message.message.content
          .filter((block): block is TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('')
        const { delta, emitted } = computeTextDelta(state.emittedText, text)
        if (delta) {
          state.emittedText = emitted
          ctx.emit(evAssistantDelta(ctx.sessionRef, delta))
        }
        break
      }
      case 'thinking': {
        const effect = subagentTaskMessageText(message.text, state.activeSubagentCallId)
        if (effect?.text) {
          ctx.emit(evToolUpdated(ctx.sessionRef, effect.callId, effect.text))
        }
        break
      }
      case 'task': {
        const effect = subagentTaskMessageText(message.text, state.activeSubagentCallId)
        if (effect?.text) {
          ctx.emit(evToolUpdated(ctx.sessionRef, effect.callId, effect.text))
        }
        break
      }
      case 'tool_call': {
        if (message.status === 'running') {
          if (isSubagentTool(message.name)) {
            state.activeSubagentCallId = message.call_id
          }
          ctx.emit(evToolStarted(ctx.sessionRef, message.call_id, message.name, message.args))
        } else {
          if (state.activeSubagentCallId === message.call_id) {
            state.activeSubagentCallId = undefined
          }
          ctx.emit(
            evToolFinished(
              ctx.sessionRef,
              message.call_id,
              message.status === 'completed',
              message.result,
            ),
          )
        }
        break
      }
      case 'status': {
        if (message.status === 'ERROR') {
          throw new Error(cursorRunErrorMessage(message.message))
        }
        break
      }
      default:
        break
    }
  }

  closeSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    this.sessions.delete(sessionId)
    if (state) {
      if (state.run) detachCursorRun(state.run)
      void disposeCursorAgent(state.agent, state.run).catch(() => {})
    }
  }
}
