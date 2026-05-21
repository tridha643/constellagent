import type {
  AssistantDeltaEvent,
  SessionDriverEvent,
  SessionRef,
  ToolFinishedEvent,
  ToolStartedEvent,
  ToolUpdatedEvent,
} from '@pi-gui/session-driver'
import type { AgentProvider } from '../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../shared/conductor-thinking'

export type { AgentProvider }

/**
 * Instruction prepended to the user's prompt when the composer Plan toggle is
 * on. Codex additionally runs in a read-only sandbox for plan turns.
 */
export const PLAN_PROMPT_PREFIX =
  'Operate in planning mode. Think through the problem and produce a clear, step-by-step implementation plan before changing anything. Do not edit files or run mutating commands in this turn — outline the plan only.'

/**
 * Prepended to every Conductor turn so assistant replies use markdown the chat
 * renderer can display (GFM headings, task lists, tables, bullets).
 */
export const CONDUCTOR_MARKDOWN_FORMAT_PREFIX =
  'Format your reply as clean GitHub-Flavored Markdown: use ATX headings (`## Section`) without wrapping the markers in bold; use `- [ ]` / `- [x]` task lists (no emoji list markers); use pipe tables with a header row and `|---|---|` separator; use `-` bullets for unordered lists.'

/** Builds the user prompt sent to agent drivers (format hint + optional plan mode). */
export function buildAgentPrompt(text: string, plan: boolean): string {
  const parts = [CONDUCTOR_MARKDOWN_FORMAT_PREFIX]
  if (plan) parts.push(PLAN_PROMPT_PREFIX)
  parts.push(text)
  return parts.join('\n\n')
}

/** Context handed to a driver for a single conversational turn. */
export interface AgentTurnContext {
  readonly sessionRef: SessionRef
  readonly workspacePath: string
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly plan: boolean
  readonly text: string
  /** Aborts the in-flight run when the user cancels. */
  readonly signal: AbortSignal
  /** Emit a streaming event (assistant text / tool activity) for the timeline. */
  emit(event: SessionDriverEvent): void
}

/**
 * Minimal pluggable backend used by `AgentChatHost`. Drivers only stream
 * assistant text + tool activity; the host owns run lifecycle (running /
 * completed / failed) and transcript persistence, so drivers stay thin.
 */
export interface AgentDriver {
  readonly provider: AgentProvider
  /** Returns null when authenticated, otherwise a user-facing message. */
  checkAuth(): string | null
  /** Runs one turn, streaming events via `ctx.emit`. Throws to signal failure. */
  runTurn(ctx: AgentTurnContext): Promise<void>
  /** Releases per-session resources (child processes, agents). */
  closeSession(sessionId: string): void
}

const now = (): string => new Date().toISOString()

export function evAssistantDelta(sessionRef: SessionRef, text: string): AssistantDeltaEvent {
  return { type: 'assistantDelta', sessionRef, timestamp: now(), text }
}

export function evToolStarted(
  sessionRef: SessionRef,
  callId: string,
  toolName: string,
  input?: unknown,
): ToolStartedEvent {
  return { type: 'toolStarted', sessionRef, timestamp: now(), callId, toolName, input }
}

export function evToolUpdated(sessionRef: SessionRef, callId: string, text?: string): ToolUpdatedEvent {
  return { type: 'toolUpdated', sessionRef, timestamp: now(), callId, text }
}

export function evToolFinished(
  sessionRef: SessionRef,
  callId: string,
  success: boolean,
  output?: unknown,
): ToolFinishedEvent {
  return { type: 'toolFinished', sessionRef, timestamp: now(), callId, success, output }
}

/**
 * Streaming SDKs emit assistant text either cumulatively (each chunk is the
 * full text so far) or incrementally (each chunk is only the new fragment).
 * This computes the new suffix to append for both shapes given what we have
 * already emitted, returning the delta and the next "emitted" baseline.
 */
export function computeTextDelta(emitted: string, incoming: string): { delta: string; emitted: string } {
  if (incoming.length === 0) return { delta: '', emitted }
  if (incoming.startsWith(emitted)) {
    return { delta: incoming.slice(emitted.length), emitted: incoming }
  }
  return { delta: incoming, emitted: emitted + incoming }
}
