import {
  type CollabAgentState,
  type CollabTool,
  type CollabToolCallItem,
  collabAgentSucceeded,
  isCollabAgentTerminal,
} from '../../shared/codex-collab-types'
import {
  collabAgentStatusLabel,
  parseCodexSpawnPrompt,
} from '../../shared/conductor-subagent-utils'
import {
  evToolFinished,
  evToolStarted,
  evToolUpdated,
  type AgentTurnContext,
} from './agent-driver'

/** Minimum Codex CLI version that emits `collab_tool_call` on `--experimental-json` exec streams. */
export const CODEX_COLLAB_MIN_CLI_VERSION = '0.130.0'

const TOOL_UPDATE_MIN_INTERVAL_MS = 120

export interface CodexCollabSessionState {
  /** child thread id → timeline call id (same id in practice). */
  readonly childThreadToCallId: Map<string, string>
  /** collab item id → tool kind for correlation. */
  readonly collabItemKind: Map<string, CollabTool>
  readonly lastStatusTextByCallId: Map<string, string>
  readonly finishedChildren: Set<string>
}

export function createCodexCollabSessionState(): CodexCollabSessionState {
  return {
    childThreadToCallId: new Map(),
    collabItemKind: new Map(),
    lastStatusTextByCallId: new Map(),
    finishedChildren: new Set(),
  }
}

export function clearCodexCollabSessionState(state: CodexCollabSessionState): void {
  state.childThreadToCallId.clear()
  state.collabItemKind.clear()
  state.lastStatusTextByCallId.clear()
  state.finishedChildren.clear()
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

export function collabProgressText(
  agentsStates: Readonly<Record<string, CollabAgentState>>,
  childThreadId: string,
): string | undefined {
  const agentState = agentsStates[childThreadId]
  if (!agentState) return undefined
  const message = agentState.message?.trim()
  if (message) return firstLine(message)
  return collabAgentStatusLabel(agentState.status)
}

function spawnInputFromPrompt(prompt?: string): Record<string, unknown> {
  const parsed = parseCodexSpawnPrompt(prompt)
  return {
    description: parsed.title,
    ...(parsed.statusHint ? { prompt: parsed.statusHint } : {}),
    ...(parsed.subagentType ? { subagent_type: parsed.subagentType } : {}),
  }
}

function shouldEmitStatusUpdate(
  state: CodexCollabSessionState,
  throttle: Map<string, { text: string; emittedAt: number }>,
  callId: string,
  text: string,
): boolean {
  const previousText = state.lastStatusTextByCallId.get(callId)
  if (previousText === text) return false

  const previous = throttle.get(callId)
  const now = performance.now()
  if (previous && previous.text === text) return false
  if (previous && now - previous.emittedAt < TOOL_UPDATE_MIN_INTERVAL_MS) return false

  throttle.set(callId, { text, emittedAt: now })
  state.lastStatusTextByCallId.set(callId, text)
  return true
}

function registerChild(
  state: CodexCollabSessionState,
  childThreadId: string,
  callId: string,
): void {
  state.childThreadToCallId.set(childThreadId, callId)
}

function emitChildStarted(
  ctx: AgentTurnContext,
  state: CodexCollabSessionState,
  childThreadId: string,
  prompt?: string,
): void {
  if (state.childThreadToCallId.has(childThreadId)) return
  const callId = childThreadId
  registerChild(state, childThreadId, callId)
  ctx.emit(
    evToolStarted(ctx.sessionRef, callId, 'spawn_agent', spawnInputFromPrompt(prompt)),
  )
}

function emitChildProgress(
  ctx: AgentTurnContext,
  state: CodexCollabSessionState,
  throttle: Map<string, { text: string; emittedAt: number }>,
  childThreadId: string,
  agentsStates: Readonly<Record<string, CollabAgentState>>,
): void {
  const callId = state.childThreadToCallId.get(childThreadId) ?? childThreadId
  if (!state.childThreadToCallId.has(childThreadId)) {
    registerChild(state, childThreadId, callId)
  }
  const text = collabProgressText(agentsStates, childThreadId)
  if (!text || !shouldEmitStatusUpdate(state, throttle, callId, text)) return
  ctx.emit(evToolUpdated(ctx.sessionRef, callId, text))
}

function emitChildFinished(
  ctx: AgentTurnContext,
  state: CodexCollabSessionState,
  childThreadId: string,
  agentState: CollabAgentState,
): void {
  if (state.finishedChildren.has(childThreadId)) return
  const callId = state.childThreadToCallId.get(childThreadId) ?? childThreadId
  state.finishedChildren.add(childThreadId)
  ctx.emit(
    evToolFinished(
      ctx.sessionRef,
      callId,
      collabAgentSucceeded(agentState.status),
      agentState,
    ),
  )
}

function handleSpawnAgent(
  ctx: AgentTurnContext,
  state: CodexCollabSessionState,
  throttle: Map<string, { text: string; emittedAt: number }>,
  eventType: 'item.started' | 'item.updated' | 'item.completed',
  item: CollabToolCallItem,
): void {
  if (eventType !== 'item.completed') return
  for (const childThreadId of item.receiver_thread_ids) {
    emitChildStarted(ctx, state, childThreadId, item.prompt)
    const agentState = item.agents_states[childThreadId]
    if (agentState) {
      emitChildProgress(ctx, state, throttle, childThreadId, item.agents_states)
      if (isCollabAgentTerminal(agentState.status)) {
        emitChildFinished(ctx, state, childThreadId, agentState)
      }
    }
  }
}

function handleWaitLikeCollab(
  ctx: AgentTurnContext,
  state: CodexCollabSessionState,
  throttle: Map<string, { text: string; emittedAt: number }>,
  eventType: 'item.started' | 'item.updated' | 'item.completed',
  item: CollabToolCallItem,
): void {
  const childIds = new Set<string>([
    ...item.receiver_thread_ids,
    ...Object.keys(item.agents_states),
  ])

  for (const childThreadId of childIds) {
    if (!state.childThreadToCallId.has(childThreadId)) {
      emitChildStarted(ctx, state, childThreadId, item.prompt)
    }
  }

  for (const childThreadId of childIds) {
    const agentState = item.agents_states[childThreadId]
    if (!agentState) continue
    if (!isCollabAgentTerminal(agentState.status)) {
      emitChildProgress(ctx, state, throttle, childThreadId, item.agents_states)
    }
  }

  if (eventType === 'item.completed') {
    const waitFailed = item.status === 'failed'
    for (const childThreadId of childIds) {
      if (state.finishedChildren.has(childThreadId)) continue
      const agentState = item.agents_states[childThreadId]
      if (agentState && isCollabAgentTerminal(agentState.status)) {
        emitChildFinished(ctx, state, childThreadId, agentState)
      } else if (waitFailed) {
        emitChildFinished(ctx, state, childThreadId, {
          status: 'errored',
          message: 'Subagent wait failed',
        })
      }
    }
  }
}

/** Maps Codex `collab_tool_call` thread items to Conductor subagent timeline events. */
export function handleCodexCollabItem(
  ctx: AgentTurnContext,
  state: CodexCollabSessionState,
  throttle: Map<string, { text: string; emittedAt: number }>,
  eventType: 'item.started' | 'item.updated' | 'item.completed',
  item: CollabToolCallItem,
): void {
  state.collabItemKind.set(item.id, item.tool)

  switch (item.tool) {
    case 'spawn_agent':
      handleSpawnAgent(ctx, state, throttle, eventType, item)
      break
    case 'wait':
    case 'send_input':
    case 'close_agent':
      handleWaitLikeCollab(ctx, state, throttle, eventType, item)
      break
    default:
      break
  }
}
