import type { QueuedAgentMessage } from './agent-chat-types'
import { CONDUCTOR_IMAGE_ONLY_PROMPT } from './conductor-attachments'
import type { ContextWindowData } from './context-window-types'
import { PLAN_MODEL_PRESETS } from './plan-build-command'
import type { TranscriptMessage } from './pi/pi-desktop-state'

const CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000
const OPENAI_CONTEXT_WINDOW_SIZE = 272_000
const LARGE_CONTEXT_WINDOW_SIZE = 1_000_000

/** Conservative visual estimate for one image input; do not count base64 bytes as text tokens. */
const IMAGE_ATTACHMENT_TOKEN_ESTIMATE = 1_024
const FILE_ATTACHMENT_FALLBACK_TOKENS = 512
const FILE_ATTACHMENT_MAX_ESTIMATE_TOKENS = 16_000

export interface TokenEstimateAttachment {
  readonly kind: string
  readonly name?: string
  readonly data?: string
  readonly sizeBytes?: number
}

const ONE_M_CONTEXT_MODEL_IDS = new Set(
  Object.values(PLAN_MODEL_PRESETS)
    .flat()
    .filter((preset) => /\b1m\b/i.test(preset.label) || /\b1m\b/i.test(preset.cliModel))
    .map((preset) => normalizeModelIdForContext(preset.cliModel)),
)

function normalizeModelIdForContext(model: string): string {
  return model.trim().toLowerCase()
}

function isKnownOneMillionContextModel(model: string): boolean {
  const id = normalizeModelIdForContext(model)
  if (!id) return false
  if (/\b1m\b|context[-_]?1m/.test(id)) return true
  if (ONE_M_CONTEXT_MODEL_IDS.has(id)) return true

  // Cursor/Codex store reasoning effort separately, so gpt-5.4-medium/high/etc.
  // often reaches this utility as plain `gpt-5.4`. The non-mini/nano family is
  // labeled as 1M in the Conductor model catalog; GPT-5.5 is treated as the same
  // large-context family for Codex defaults.
  if (/^gpt-5\.(?:4|5)(?:$|[-_])/.test(id) && !/^gpt-5\.4[-_](mini|nano)(?:$|[-_])/.test(id)) {
    return true
  }

  // Cursor's Claude/Gemini presets expose 1M variants without always retaining
  // the literal "1m" token after Conductor strips effort suffixes.
  if (/^claude-4\.(?:5|6)-(?:sonnet|opus)(?:$|[-_])/.test(id)) return true
  if (/^gemini-(?:2\.5|3)(?:$|[-_])/.test(id)) return true

  return false
}

function isKnownOpenAiContextModel(model: string): boolean {
  const id = normalizeModelIdForContext(model)
  if (!id) return false

  // GPT-5.4/GPT-5.5 Codex sessions report a 272K token window. Some model
  // presets still carry historical "1M" labels, so classify these before the
  // generic one-million-context lookup.
  if (/^gpt-5\.(?:4|5)(?:$|[-_])/.test(id) && !/^gpt-5\.4[-_](mini|nano)(?:$|[-_])/.test(id)) {
    return true
  }

  return false
}

export function inferContextWindowSize(model: string, _usedTokens = 0): number {
  if (isKnownOpenAiContextModel(model)) return OPENAI_CONTEXT_WINDOW_SIZE
  return isKnownOneMillionContextModel(model) ? LARGE_CONTEXT_WINDOW_SIZE : DEFAULT_CONTEXT_WINDOW_SIZE
}

export function computeContextPercentage(usedTokens: number, contextWindowSize: number): number {
  const total = Math.max(1, contextWindowSize)
  return Math.min(100, Math.max(0, Math.round((usedTokens / total) * 1000) / 10))
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function estimateChars(value: unknown, depth = 0): number {
  if (value == null || depth > 2) return 0
  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + estimateChars(item, depth + 1), 0)
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (sum, item) => sum + estimateChars(item, depth + 1),
      0,
    )
  }
  return 0
}

export function estimateTokensFromAttachments(
  attachments: readonly TokenEstimateAttachment[] | undefined,
): number {
  if (!attachments?.length) return 0
  return attachments.reduce<number>((sum, attachment) => {
    const nameTokens = estimateTokensFromText(attachment.name ?? '')
    if (attachment.kind === 'image') {
      return sum + IMAGE_ATTACHMENT_TOKEN_ESTIMATE + nameTokens
    }
    if (attachment.kind === 'file') {
      const sizeEstimate =
        typeof attachment.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes)
          ? Math.ceil(Math.max(0, attachment.sizeBytes) / CHARS_PER_TOKEN)
          : FILE_ATTACHMENT_FALLBACK_TOKENS
      return sum + Math.min(sizeEstimate, FILE_ATTACHMENT_MAX_ESTIMATE_TOKENS) + nameTokens
    }
    return sum + nameTokens
  }, 0)
}

/** Rough token estimate from Conductor transcript rows (messages, tools, activity). */
export function estimateTokensFromTranscript(transcript: readonly TranscriptMessage[]): number {
  let chars = 0
  let attachmentTokens = 0

  for (const item of transcript) {
    switch (item.kind) {
      case 'message':
        chars += item.text.length
        attachmentTokens += estimateTokensFromAttachments(item.attachments)
        break
      case 'tool':
        chars += item.label.length
        chars += item.detail?.length ?? 0
        chars += item.metadata?.length ?? 0
        chars += Math.min(estimateChars(item.input), 8_000)
        chars += Math.min(estimateChars(item.output), 8_000)
        break
      case 'activity':
        chars += item.label.length
        chars += item.detail?.length ?? 0
        chars += item.metadata?.length ?? 0
        break
      case 'summary':
        chars += item.label.length
        chars += item.metadata?.length ?? 0
        break
      default:
        break
    }
  }

  return Math.ceil(chars / CHARS_PER_TOKEN) + attachmentTokens
}

export function estimateTokensFromComposerMessage(
  text: string,
  attachments: readonly TokenEstimateAttachment[] | undefined = [],
): number {
  const trimmed = text.trim()
  const normalizedText = trimmed || (attachments.length > 0 ? CONDUCTOR_IMAGE_ONLY_PROMPT : '')
  return estimateTokensFromText(normalizedText) + estimateTokensFromAttachments(attachments)
}

export function estimateTokensFromQueuedMessages(
  messages: readonly QueuedAgentMessage[] | undefined,
): number {
  if (!messages?.length) return 0
  return messages.reduce(
    (sum, message) => sum + estimateTokensFromComposerMessage(message.text, message.attachments),
    0,
  )
}

export function buildContextWindowData(input: {
  usedTokens: number
  model: string
  sessionId: string
  contextWindowSize?: number
}): ContextWindowData {
  const usedTokens = Math.max(0, input.usedTokens)
  const contextWindowSize = input.contextWindowSize ?? inferContextWindowSize(input.model, usedTokens)
  return {
    usedTokens,
    contextWindowSize,
    percentage: computeContextPercentage(usedTokens, contextWindowSize),
    model: input.model,
    sessionId: input.sessionId,
    lastUpdated: Date.now(),
  }
}

export function buildComposerContextWindowData(input: {
  model: string
  sessionId?: string | null
  baseUsage?: ContextWindowData | null
  transcript?: readonly TranscriptMessage[]
  queuedMessages?: readonly QueuedAgentMessage[]
  draftText?: string
  draftAttachments?: readonly TokenEstimateAttachment[]
}): ContextWindowData {
  const sessionId = input.sessionId ?? input.baseUsage?.sessionId ?? ''
  const baseUsageMatches =
    input.baseUsage &&
    (!sessionId || !input.baseUsage.sessionId || input.baseUsage.sessionId === sessionId)
  const transcriptTokens = estimateTokensFromTranscript(input.transcript ?? [])
  const baseTokens = baseUsageMatches ? input.baseUsage?.usedTokens ?? 0 : 0
  const queuedTokens = estimateTokensFromQueuedMessages(input.queuedMessages)
  const draftTokens = estimateTokensFromComposerMessage(
    input.draftText ?? '',
    input.draftAttachments ?? [],
  )

  return buildContextWindowData({
    usedTokens: Math.max(baseTokens, transcriptTokens) + queuedTokens + draftTokens,
    model: input.model || input.baseUsage?.model || '',
    sessionId,
  })
}

export const CONDUCTOR_CONTEXT_IDLE: ContextWindowData = {
  usedTokens: 0,
  contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
  percentage: 0,
  model: '',
  sessionId: '',
  lastUpdated: 0,
}
