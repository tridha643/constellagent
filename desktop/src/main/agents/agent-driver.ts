import type {
  AssistantDeltaEvent,
  HostUiResponse,
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
import type { ModelPreset } from '../../shared/plan-build-command'
import { formatTranscriptForAgentContext } from '../../shared/conductor-transcript-utils'
import { buildJsonCanvasPromptSuffix } from '../../shared/json-canvas-schema'
import { isHarnessSlashCommand } from '../../shared/conductor-composer-commands'

export type { AgentProvider }

/**
 * Instruction prepended to the user's prompt when the composer Plan toggle is
 * on. Plan mode is a behavioral prompt/UI state; SDK permissions are configured
 * separately in conductor-sdk-cli-permissions.
 */
export const PLAN_PROMPT_PREFIX = [
  'Operate in Conductor planning mode. Investigate with read-only tools, shell commands, MCP tools, and network CLIs only when they do not mutate files or external state.',
  'Do not edit, create, delete, rename, format, or save files anywhere. Do not write plan files.',
  'Do not run mutating package manager, git, deploy, codegen, database, migration, install, or index commands.',
  'Return the plan directly in the Conductor chat response as clean Markdown for ChatView to render.',
].join(' ')

export const PLAN_PROMPT_CURSOR_ASK =
  'When important scope or behavior is still unclear, use the native AskQuestion tool to ask 3-4 strong multiple-choice questions first (2-4 options each, include tradeoffs, mark a recommended default when confident).'

/**
 * Prepended to every Conductor turn so assistant replies use markdown the chat
 * renderer can display (GFM headings, task lists, tables, bullets).
 */
export const CONDUCTOR_MARKDOWN_FORMAT_PREFIX =
  [
    'Format your reply as clean GitHub-Flavored Markdown: use ATX headings (`## Section`) without wrapping the markers in bold; use `- [ ]` / `- [x]` task lists (no emoji list markers); use pipe tables with a header row and `|---|---|` separator; use `-` bullets for unordered lists.',
    'Conductor renders assistant replies in a live markdown preview. Render diagrams and charts in chat with fenced Mermaid blocks, using `xychart-beta` for numeric/bar/line charts when appropriate.',
    'Do not invoke image generation tools or create PNG/JPG/WebP/SVG image files for diagrams, charts, architecture, plans, or other content Mermaid can express. Only generate raster images when the user explicitly asks for a photo, icon, mockup, or other non-Mermaid visual.',
  ].join(' ')

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
  if (provider === 'pi' && isSingleLineSlashCommand(text)) {
    return text.trim()
  }
  if (isHarnessSlashCommand(text)) {
    return text.trim()
  }
  const parts: string[] = []
  if (canvas && provider && provider !== 'pi') {
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

function isSingleLineSlashCommand(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('/') && !/\n/.test(trimmed) && /^\/[^\s]+(?:\s+\S+)*$/.test(trimmed)
}

/** Context handed to a driver for a single conversational turn. */
export interface AgentTurnContext {
  readonly sessionRef: SessionRef
  readonly workspacePath: string
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly plan: boolean
  /** When true, drivers use json-render inline mode (prose + SpecStream JSONL in assistant text). */
  readonly canvas: boolean
  readonly text: string
  readonly attachments?: readonly ConductorComposerAttachment[]
  /** Prior persisted UI transcript for seeding newly-created backend SDK state. */
  readonly previousTranscript?: readonly TranscriptMessage[]
  readonly providerSession?: { readonly workspaceId: string; readonly sessionId: string }
  setProviderSession?(providerSession: { readonly workspaceId: string; readonly sessionId: string }): void
  setPiExtensionUi?(ui: import('../../shared/pi/pi-desktop-state').SessionExtensionUiStateRecord | null): void
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
  respondHostUi?(sessionId: string, response: HostUiResponse): Promise<void>
  sendExtensionTuiInput?(sessionId: string, data: string): void
  getPiExtensionUi?(
    sessionId: string,
  ): import('../../shared/pi/pi-desktop-state').SessionExtensionUiStateRecord | null
  listModelsForWorkspace?(workspacePath: string): Promise<readonly ModelPreset[]>
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

function isAlphanumericChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char)
}

/** Pi/Cursor word-sized tokens often omit leading spaces; insert one at word boundaries. */
export function needsAssistantWordBoundarySpace(existing: string, delta: string): boolean {
  if (delta.length === 0 || /^\s/.test(delta)) return false
  const last = existing.at(-1)
  const first = delta.at(0)
  if (!last || !first) return false
  return isAlphanumericChar(last) && isAlphanumericChar(first)
}

/**
 * Normalizes assistant stream chunks for both cumulative snapshots and
 * incremental word tokens before appending to transcript or broadcasting.
 */
export function normalizeAssistantStreamDelta(
  emitted: string,
  incoming: string,
): { delta: string; emitted: string } {
  const { delta: rawDelta } = computeTextDelta(emitted, incoming)
  if (rawDelta.length === 0) {
    return { delta: '', emitted }
  }
  const prefix = needsAssistantWordBoundarySpace(emitted, rawDelta) ? ' ' : ''
  const delta = `${prefix}${rawDelta}`
  return { delta, emitted: emitted + delta }
}
