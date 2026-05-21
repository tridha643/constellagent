import '../cursor-sdk-ripgrep-config'
import {
  Agent,
  convertError,
  type Run,
  type SDKAgent,
  type SDKMessage,
  type TextBlock,
} from '@cursor/sdk'
import { checkCursorAuth, getCursorApiKey } from '../conductor-auth'
import {
  computeTextDelta,
  evAssistantDelta,
  evToolFinished,
  evToolStarted,
  buildAgentPrompt,
  type AgentDriver,
  type AgentTurnContext,
} from './agent-driver'
import { applyThinkingLevel } from '../../shared/conductor-model-utils'

interface CursorSessionState {
  agent: SDKAgent
  model: string
  /** Assistant text streamed so far this turn, for delta computation. */
  emittedText: string
  run?: Run
}

/** gRPC/Connect "canceled" code — see connectrpc.com/docs/protocol#error-codes */
const CONNECT_CODE_CANCELED = 1

function connectErrorCode(err: unknown): number | undefined {
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
    if (!state || state.model !== effectiveModel) {
      if (state) {
        await disposeCursorAgent(state.agent, state.run).catch(() => {})
      }
      const apiKey = getCursorApiKey()
      let agent: SDKAgent
      try {
        agent = await Agent.create({
          ...(apiKey ? { apiKey } : {}),
          model: { id: effectiveModel },
          local: { cwd: ctx.workspacePath },
        })
      } catch (err) {
        throw toCursorUserError(err)
      }
      state = { agent, model: effectiveModel, emittedText: '' }
      this.sessions.set(key, state)
    }

    const prompt = buildAgentPrompt(ctx.text, ctx.plan)
    let run: Run
    try {
      run = await state.agent.send(prompt, { model: { id: effectiveModel } })
    } catch (err) {
      throw toCursorUserError(err)
    }
    state.run = run
    state.model = effectiveModel
    state.emittedText = ''

    const onAbort = (): void => {
      if (run.supports('cancel')) {
        void run.cancel().catch(() => {})
      }
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
        throw new Error(run.result ?? 'Cursor run failed')
      }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
      state.run = undefined
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
      case 'tool_call': {
        if (message.status === 'running') {
          ctx.emit(evToolStarted(ctx.sessionRef, message.call_id, message.name, message.args))
        } else {
          ctx.emit(evToolFinished(ctx.sessionRef, message.call_id, message.status === 'completed', message.result))
        }
        break
      }
      case 'status': {
        if (message.status === 'ERROR') {
          throw new Error(message.message ?? 'Cursor run error')
        }
        break
      }
      default:
        break
    }
  }

  closeSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state) {
      void disposeCursorAgent(state.agent, state.run).catch(() => {})
    }
    this.sessions.delete(sessionId)
  }
}
