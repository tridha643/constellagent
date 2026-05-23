import type {
  AssistantDeltaEvent,
  SessionDriverEvent,
  SessionRef,
  ToolFinishedEvent,
  ToolStartedEvent,
  ToolUpdatedEvent,
} from '@pi-gui/session-driver'
import type { AgentProvider } from '../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../shared/conductor-attachments'
import type { ThinkingLevel } from '../../shared/conductor-thinking'
import type { TranscriptMessage } from '../../shared/pi/pi-desktop-state'
import { formatTranscriptForAgentContext } from '../../shared/conductor-transcript-utils'
import { AGENT_PLAN_DIRS_LABEL } from '../../shared/agent-plan-path'
import { buildJsonCanvasPromptSuffix } from '../../shared/json-canvas-schema'

export type { AgentProvider }

/**
 * Instruction prepended to the user's prompt when the composer Plan toggle is
 * on. Codex plan turns use CODEX_PLAN_THREAD_PERMISSIONS (workspace-write + network);
 * working turns use CODEX_WORKING_THREAD_PERMISSIONS (fully unrestricted).
 */
export const PLAN_PROMPT_PREFIX = [
  'Operate in planning mode. Investigate freely with read-only tools, shell commands, MCP tools, and network CLIs (e.g. nia sources summary, nia search query, gh issue view, git log, curl, npm view).',
  `You may create or edit markdown plan files only under these workspace directories: ${AGENT_PLAN_DIRS_LABEL}.`,
  'Do not edit, create, delete, or rename any other workspace paths. Do not run mutating package manager, git, deploy, or index commands unless they are strictly read-only.',
  'Produce a clear step-by-step implementation plan before implementing anything outside those plan directories.',
].join(' ')

export const PLAN_PROMPT_CURSOR_ASK =
  'When important scope or behavior is still unclear, use the native AskQuestion tool to ask 3-4 strong multiple-choice questions first (2-4 options each, include tradeoffs, mark a recommended default when confident).'

/**
 * Prepended to every Conductor turn so assistant replies use markdown the chat
 * renderer can display (GFM headings, task lists, tables, bullets).
 */
export const CONDUCTOR_MARKDOWN_FORMAT_PREFIX =
  'Format your reply as clean GitHub-Flavored Markdown: use ATX headings (`## Section`) without wrapping the markers in bold; use `- [ ]` / `- [x]` task lists (no emoji list markers); use pipe tables with a header row and `|---|---|` separator; use `-` bullets for unordered lists.'

const CONDUCTOR_CONTEXT_PROMPT_PREFIX =
  'Previous conversation context from this Conductor chat is below. Use it as the authoritative thread history, including any plan the assistant already produced.'

/** Builds the user prompt sent to agent drivers (format hint + optional plan/canvas mode/context). */
export function buildAgentPrompt(
  text: string,
  plan: boolean,
  previousTranscript?: readonly TranscriptMessage[],
  provider?: AgentProvider,
  canvas = false,
): string {
  const parts: string[] = []
  if (canvas && provider) {
    parts.push(buildJsonCanvasPromptSuffix(provider))
  } else {
    parts.push(CONDUCTOR_MARKDOWN_FORMAT_PREFIX)
  }
  if (plan) {
    parts.push(PLAN_PROMPT_PREFIX)
    if (provider === 'cursor') parts.push(PLAN_PROMPT_CURSOR_ASK)
  }
  const previousContext = previousTranscript
    ? formatTranscriptForAgentContext(previousTranscript)
    : undefined
  if (previousContext) {
    parts.push(`${CONDUCTOR_CONTEXT_PROMPT_PREFIX}\n\n${previousContext}`)
    parts.push(`Current user request:\n${text}`)
  } else {
    parts.push(text)
  }
  return parts.join('\n\n')
}

/** Context handed to a driver for a single conversational turn. */
export interface AgentTurnContext {
  readonly sessionRef: SessionRef
  readonly workspacePath: string
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly plan: boolean
  /** When true, drivers request structured canvas JSON instead of markdown prose. */
  readonly canvas: boolean
  readonly text: string
  readonly attachments?: readonly ConductorComposerAttachment[]
  /** Prior persisted UI transcript for seeding newly-created backend SDK state. */
  readonly previousTranscript?: readonly TranscriptMessage[]
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
  /** Optional provider-specific recovery hook used after user interrupts or stale resumes. */
  markSessionInterrupted?(sessionId: string): void
  /** Releases per-session resources (child processes, agents). */
  closeSession(sessionId: string): void
  /** Provider-reported input-side tokens for the latest completed turn, when available. */
  getContextUsage?(sessionId: string): number | null
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

export function evToolUpdated(
  sessionRef: SessionRef,
  callId: string,
  text?: string,
  output?: unknown,
): ToolUpdatedEvent {
  return { type: 'toolUpdated', sessionRef, timestamp: now(), callId, text, output }
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
