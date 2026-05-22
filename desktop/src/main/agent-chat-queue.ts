import { randomUUID } from 'node:crypto'
import type { QueuedAgentMessage, QueuedAgentMessageMode } from '../shared/agent-chat-types'
import {
  cloneConductorImageAttachments,
  normalizeConductorImageAttachments,
  type ConductorComposerAttachment,
} from '../shared/conductor-attachments'

export function createQueuedMessage(
  text: string,
  mode: QueuedAgentMessageMode,
  timestamp = new Date().toISOString(),
  attachments: readonly ConductorComposerAttachment[] = [],
): QueuedAgentMessage {
  const normalizedAttachments = cloneConductorImageAttachments(attachments)
  return {
    id: randomUUID(),
    mode,
    text,
    ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** Append a message; steer replaces any existing steer slot (Pi pattern). */
export function enqueueQueuedMessage(
  queue: readonly QueuedAgentMessage[],
  text: string,
  mode: QueuedAgentMessageMode,
  timestamp = new Date().toISOString(),
  attachments: readonly ConductorComposerAttachment[] = [],
): QueuedAgentMessage[] {
  const message = createQueuedMessage(text, mode, timestamp, attachments)
  if (mode === 'steer') {
    return [...queue.filter((item) => item.mode !== 'steer'), message]
  }
  return [...queue, message]
}

export function parseQueuedMessagesJson(raw: unknown): QueuedAgentMessage[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isQueuedAgentMessage)
  } catch {
    return []
  }
}

function isQueuedAgentMessage(value: unknown): value is QueuedAgentMessage {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const attachmentsValid =
    record.attachments === undefined ||
    (Array.isArray(record.attachments) &&
      normalizeConductorImageAttachments(
        record.attachments as readonly ConductorComposerAttachment[],
      ).length === record.attachments.length)
  return (
    typeof record.id === 'string' &&
    (record.mode === 'followUp' || record.mode === 'steer') &&
    typeof record.text === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    attachmentsValid
  )
}

export function findSteerMessageIndex(queue: readonly QueuedAgentMessage[]): number {
  return queue.findIndex((item) => item.mode === 'steer')
}

export function removeQueuedMessage(
  queue: readonly QueuedAgentMessage[],
  messageId: string,
): QueuedAgentMessage[] {
  return queue.filter((item) => item.id !== messageId)
}

export function moveQueuedMessageUp(
  queue: readonly QueuedAgentMessage[],
  messageId: string,
): QueuedAgentMessage[] {
  const index = queue.findIndex((item) => item.id === messageId)
  if (index <= 0) return [...queue]
  const next = [...queue]
  const [item] = next.splice(index, 1)
  next.splice(index - 1, 0, item)
  return next
}

export function updateQueuedMessageText(
  queue: readonly QueuedAgentMessage[],
  messageId: string,
  text: string,
  timestamp = new Date().toISOString(),
): QueuedAgentMessage[] {
  return queue.map((item) =>
    item.id === messageId ? { ...item, text, updatedAt: timestamp } : item,
  )
}
