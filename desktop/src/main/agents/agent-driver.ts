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
 * Formatting contract for assistant replies the Conductor markdown preview can
 * render (GFM headings, task lists, tables, bullets; Mermaid for diagrams).
 *
 * Sent **once per thread** (on the first turn) rather than re-prepended to every
 * turn: the provider threads are persistent, so the model retains it in history
 * like a system instruction. Drivers gate this via `includeFormatPrefix` so we
 * don't re-bill ~75 tokens of identical context on every subsequent turn.
 */
export const CONDUCTOR_MARKDOWN_FORMAT_PREFIX =
  'Reply in GitHub-Flavored Markdown for a live preview: ATX headings (`## Section`, never bold-wrapped), `-` bullets, `- [ ]` / `- [x]` task lists, and pipe tables with a `|---|---|` header separator. Render diagrams and charts as fenced Mermaid blocks (`xychart-beta` for numeric/bar/line charts) — do not generate PNG/JPG/WebP/SVG image files for anything Mermaid can express; only create raster images when the user explicitly asks for a photo, icon, or mockup.'

export const CONDUCTOR_RTK_PROMPT_PREFIX =
  'Use RTK for shell-style work so command output is compact before it reaches context: prefer `rtk git ...`, `rtk grep ...`, `rtk find ...`, `rtk read ...`, `rtk test <cmd>`, `rtk err <cmd>`, or the closest `rtk` wrapper for searches, file reads, git, build, lint, and test commands. If `rtk` is not installed, say so briefly and keep fallback command output tightly scoped.'

/**
 * Codex-only, sent once per thread alongside the format prefix (persists in
 * thread history). Reinforces — at the user-message level — what the custom
 * collaboration-mode developer instructions establish: the `request_user_input`
 * tool is available and should be used at real decision points.
 */
export const CONDUCTOR_CODEX_ASK_PROMPT_PREFIX =
  'You have a `request_user_input` tool that shows the user rich multiple-choice questions in this app. Use it whenever a decision, preference, ambiguity, or risky assumption could change the outcome — ask early instead of guessing. Never ask a multiple-choice question as plain text.'

const CONDUCTOR_CONTEXT_PROMPT_PREFIX =
  'Previous conversation context from this Conductor chat is below. Use it as the authoritative thread history, including any plan the assistant already produced.'

/**
 * Whether `buildAgentPrompt` will actually emit `CONDUCTOR_MARKDOWN_FORMAT_PREFIX`
 * for these inputs. Drivers use this to mark a thread "primed" only when the
 * prefix was really sent (i.e. not a slash command, not canvas mode, and the
 * caller opted in) — single source of truth so priming can't drift from the
 * builder's own branching.
 */
export function promptEmitsFormatPrefix(
  text: string,
  provider: AgentProvider | undefined,
  canvas: boolean,
  includeFormatPrefix: boolean,
  isSkillInvocation = false,
): boolean {
  if (!includeFormatPrefix) return false
  if (isSkillInvocation) return false
  if (provider === 'pi' && isSingleLineSlashCommand(text)) return false
  if (isHarnessSlashCommand(text)) return false
  if (canvas && provider && provider !== 'pi') return false
  return true
}

/**
 * Builds the user prompt sent to agent drivers (format hint + optional plan/canvas mode/context).
 *
 * `includeFormatPrefix` lets persistent-thread drivers send the markdown
 * formatting contract only on a thread's first turn (it stays in history
 * thereafter); pass `false` on continuation turns to avoid re-billing it.
 */
export function buildAgentPrompt(
  text: string,
  plan: boolean,
  previousTranscript?: readonly TranscriptMessage[],
  provider?: AgentProvider,
  canvas = false,
  includeFormatPrefix = true,
  isSkillInvocation = false,
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
  } else if (promptEmitsFormatPrefix(text, provider, canvas, includeFormatPrefix, isSkillInvocation)) {
    parts.push(CONDUCTOR_MARKDOWN_FORMAT_PREFIX)
    parts.push(CONDUCTOR_RTK_PROMPT_PREFIX)
    if (provider === 'codex') {
      parts.push(CONDUCTOR_CODEX_ASK_PROMPT_PREFIX)
    }
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

/** Context handed to a driver for a user-initiated context compaction. */
export interface AgentCompactContext {
  readonly sessionRef: SessionRef
  readonly workspacePath: string
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly plan: boolean
  readonly canvas: boolean
  readonly customInstructions?: string
  readonly previousTranscript?: readonly TranscriptMessage[]
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
  /** Compacts or resets the provider-native backing session. */
  compactSession?(ctx: AgentCompactContext): Promise<void>
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
 * Appends a driver-emitted delta fragment without word-boundary normalization.
 * Cursor/Codex/Pi drivers already run `computeTextDelta` and emit append fragments;
 * the host must not re-normalize or mid-word tokens become `" ex"` instead of `"ex"`.
 */
export function appendAssistantStreamDelta(
  emitted: string,
  fragment: string,
): { delta: string; emitted: string } {
  if (fragment.length === 0) {
    return { delta: '', emitted }
  }
  return { delta: fragment, emitted: emitted + fragment }
}

/**
 * Normalizes **cumulative snapshot** assistant stream chunks (e.g. Pi word tokens)
 * before appending. Do not use at the chat host for driver-emitted deltas.
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
