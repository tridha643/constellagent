import type { TranscriptMessage } from './pi/pi-desktop-state'

const MAX_AGENT_CONTEXT_CHARS = 24_000

function newId(): string {
  return globalThis.crypto.randomUUID()
}

/** Apply a streaming assistant token on the renderer without replacing the full transcript. */
export function applyAssistantDeltaToTranscript(
  transcript: readonly TranscriptMessage[],
  messageId: string,
  text: string,
): TranscriptMessage[] {
  if (text.length === 0) return [...transcript]
  const last = transcript[transcript.length - 1]
  if (
    last?.id === messageId &&
    last.kind === 'message' &&
    last.role === 'assistant'
  ) {
    const next = transcript.slice() as TranscriptMessage[]
    next[next.length - 1] = { ...last, text: `${last.text}${text}` }
    return next
  }
  const index = transcript.findIndex((item) => item.id === messageId)
  if (index >= 0) {
    const current = transcript[index]
    if (current.kind === 'message' && current.role === 'assistant') {
      const next = transcript.slice() as TranscriptMessage[]
      next[index] = { ...current, text: `${current.text}${text}` }
      return next
    }
  }
  return [
    ...(transcript as TranscriptMessage[]),
    {
      kind: 'message',
      id: messageId,
      role: 'assistant',
      text,
      createdAt: new Date().toISOString(),
    },
  ]
}

const WORKING_LABEL = 'Working…'
const WORKED_FOR_PREFIX = 'Worked for '

export interface ConductorTurn {
  readonly userMessageId: string
  readonly userText: string
  readonly assistantPreview?: string
  readonly assistantMessageId?: string
  /** True when this user message was sent with plan mode enabled. */
  readonly plan?: boolean
}

/** Compact duration for message footer (e.g. "4s", "1m 2s"). */
export function parseWorkedForLabel(label: string): string | undefined {
  if (!label.startsWith(WORKED_FOR_PREFIX)) return undefined
  return label.slice(WORKED_FOR_PREFIX.length).trim() || undefined
}

/** Map assistant message id → footer duration from the following "Worked for …" divider. */
export function buildTurnDurationMap(transcript: readonly TranscriptMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (let i = 0; i < transcript.length; i++) {
    const item = transcript[i]
    if (item.kind !== 'summary' || item.presentation !== 'divider') continue
    const duration = parseWorkedForLabel(item.label)
    if (!duration) continue
    for (let j = i - 1; j >= 0; j--) {
      const prev = transcript[j]
      if (prev.kind === 'message' && prev.role === 'assistant') {
        map.set(prev.id, duration)
        break
      }
    }
  }
  return map
}

function trimTrailingIncompleteTurn(slice: TranscriptMessage[]): TranscriptMessage[] {
  const out = [...slice]
  while (out.length > 0) {
    const last = out[out.length - 1]
    if (last.kind === 'activity' && last.label === WORKING_LABEL) {
      out.pop()
      continue
    }
    if (last.kind === 'tool' && last.status === 'running') {
      out.pop()
      continue
    }
    break
  }
  return out
}

/** Full transcript slice through fork point, with trailing in-flight rows removed. */
export function sliceTranscriptForFork(
  transcript: readonly TranscriptMessage[],
  upToMessageId: string,
): TranscriptMessage[] {
  const idx = transcript.findIndex((item) => item.id === upToMessageId)
  if (idx < 0) return []
  return trimTrailingIncompleteTurn(transcript.slice(0, idx + 1) as TranscriptMessage[])
}

/** Clone fork slice with fresh ids so the new session is independent. */
export function cloneTranscriptWithNewIds(slice: readonly TranscriptMessage[]): TranscriptMessage[] {
  return slice.map((item) => {
    const id = newId()
    if (item.kind === 'tool') {
      return { ...item, id, callId: newId() }
    }
    return { ...item, id }
  })
}

/** User turns with optional assistant preview for the previous-messages panel. */
export function groupTranscriptIntoTurns(transcript: readonly TranscriptMessage[]): ConductorTurn[] {
  const turns: ConductorTurn[] = []
  let pendingAssistant: { id: string; text: string } | undefined

  for (const item of transcript) {
    if (item.kind === 'message' && item.role === 'assistant') {
      if (!pendingAssistant && item.text.trim()) {
        pendingAssistant = { id: item.id, text: item.text }
      }
      continue
    }
    if (item.kind === 'message' && item.role === 'user') {
      if (turns.length > 0) {
        const prev = turns[turns.length - 1]
        if (pendingAssistant && !prev.assistantPreview) {
          turns[turns.length - 1] = {
            ...prev,
            assistantPreview: truncatePreview(pendingAssistant.text),
            assistantMessageId: pendingAssistant.id,
          }
        }
      }
      pendingAssistant = undefined
      turns.push({
        userMessageId: item.id,
        userText: item.text,
        ...(item.conductorPlan === true ? { plan: true as const } : {}),
      })
    }
  }

  if (turns.length > 0 && pendingAssistant) {
    const prev = turns[turns.length - 1]
    if (!prev.assistantPreview) {
      turns[turns.length - 1] = {
        ...prev,
        assistantPreview: truncatePreview(pendingAssistant.text),
        assistantMessageId: pendingAssistant.id,
      }
    }
  }

  return turns
}

/**
 * Compact user/assistant transcript used to seed a newly-created SDK backend
 * thread. Tool/activity rows are UI timeline detail and are intentionally
 * omitted so the agent sees the durable conversation, not renderer chrome.
 */
export function formatTranscriptForAgentContext(
  transcript: readonly TranscriptMessage[],
  maxChars = MAX_AGENT_CONTEXT_CHARS,
): string | undefined {
  const parts: string[] = []

  for (const item of transcript) {
    if (item.kind !== 'message') continue
    const text = item.text.trim()
    if (!text) continue
    const role = item.role === 'user'
      ? item.conductorPlan === true
        ? 'User (plan mode)'
        : 'User'
      : 'Assistant'
    parts.push(`### ${role}\n${text}`)
  }

  if (parts.length === 0) return undefined

  const joined = parts.join('\n\n')
  if (joined.length <= maxChars) return joined

  return `[Earlier conversation truncated]\n\n${joined.slice(-maxChars)}`
}

function truncatePreview(text: string, max = 72): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1)}…`
}
