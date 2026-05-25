// Subscribes to AgentChatHost's outbound stream (the same one the renderer
// listens to over Electron IPC) and republishes a normalized MobileEvent
// stream to paired iPhones via the secure transport. Conductor SQLite is the
// single source of truth — we never persist a separate event log here beyond
// the existing mobile_events table.

import { IPC } from '@shared/ipc-channels'
import type { MobileEventType } from '@constellagent/mobile-protocol'
import type { AgentChatBroadcastListener, AgentChatHost } from './agent-chat-host'
import type { MobileLocalServer } from './mobile-local-server'
import { mobileDebugLog, shouldSampleMobileDelta } from './mobile-debug-log'

export interface MobileEventBridgeOptions {
  readonly agentChatHost: AgentChatHost
  readonly mobileServer: MobileLocalServer
}

export interface MobileEventBridge {
  dispose(): void
}

interface NormalizedBroadcast {
  readonly type: MobileEventType
  readonly sessionId?: string
  readonly workspaceId?: string
  readonly payload: Record<string, unknown>
}

export function createMobileEventBridge(options: MobileEventBridgeOptions): MobileEventBridge {
  const deltaSequenceBySession = new Map<string, number>()
  const normalize = createBroadcastNormalizer()
  const listener: AgentChatBroadcastListener = (channel, payload) => {
    const normalized = normalize(channel, payload)
    if (!normalized) return
    if (normalized.type === 'session.message.delta') {
      const sessionId = normalized.sessionId ?? 'unknown'
      const sequence = (deltaSequenceBySession.get(sessionId) ?? 0) + 1
      deltaSequenceBySession.set(sessionId, sequence)
      const text = typeof normalized.payload.text === 'string' ? normalized.payload.text : ''
      if (shouldSampleMobileDelta(sequence)) {
        mobileDebugLog('event-bridge', 'publish session.message.delta', {
          sessionId,
          sequence,
          deltaChars: text.length,
          deltaPreview: text.slice(0, 48),
          messageId: normalized.payload.messageId ?? null,
        })
      }
    } else {
      mobileDebugLog('event-bridge', `publish ${normalized.type}`, {
        sessionId: normalized.sessionId ?? null,
        workspaceId: normalized.workspaceId ?? null,
        payload: normalized.payload,
      })
      if (normalized.type === 'session.message.completed') {
        deltaSequenceBySession.delete(normalized.sessionId ?? '')
      }
    }
    void options.mobileServer
      .publishEvent({
        type: normalized.type,
        ...(normalized.sessionId ? { sessionId: normalized.sessionId } : {}),
        ...(normalized.workspaceId ? { workspaceId: normalized.workspaceId } : {}),
        payload: normalized.payload,
      })
      .catch((error) => {
        console.warn('[mobile-event-bridge] publishEvent failed', error)
      })
  }
  const dispose = options.agentChatHost.subscribeBroadcasts(listener)
  return { dispose }
}

function createBroadcastNormalizer(): (channel: string, payload: unknown) => NormalizedBroadcast | null {
  const runningSessions = new Set<string>()
  return (channel, payload) => normalizeBroadcast(channel, payload, runningSessions)
}

function normalizeBroadcast(
  channel: string,
  payload: unknown,
  runningSessions: Set<string>,
): NormalizedBroadcast | null {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  switch (channel) {
    case IPC.AGENT_CHAT_STATE_CHANGED: {
      const sessionId = stringOrNull(obj.sessionId)
      const workspaceId = stringOrNull(obj.workspaceId)
      const status = stringOrNull((obj as { status?: unknown }).status)
      const runPhase = stringOrNull((obj as { runPhase?: unknown }).runPhase)
      const error = stringOrNull((obj as { error?: unknown }).error)
      const blockingQuestion = blockingQuestionPayload((obj as { blockingQuestion?: unknown }).blockingQuestion)
      const wasRunning = sessionId ? runningSessions.has(sessionId) : false
      const isRunning = status === 'running'
      const isTerminal = status === 'idle'
        || status === 'failed'
        || runPhase === 'idle'
        || runPhase === 'failed'

      if (sessionId && isRunning) {
        runningSessions.add(sessionId)
      }

      if (runPhase === 'awaitingUser' && sessionId && blockingQuestion) {
        return {
          type: 'session.needs_input',
          sessionId,
          ...(workspaceId ? { workspaceId } : {}),
          payload: blockingQuestion,
        }
      }

      if (isRunning) {
        return {
          type: 'session.started',
          ...(sessionId ? { sessionId } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          payload: {
            status: status ?? null,
            runPhase: runPhase ?? null,
            title: stringOrNull((obj as { title?: unknown }).title) ?? null,
            error: error ?? null,
          },
        }
      }

      if (sessionId && isTerminal) {
        runningSessions.delete(sessionId)
      }
      if (!wasRunning || !isTerminal) {
        return null
      }

      return {
        type: 'session.message.completed',
        ...(sessionId ? { sessionId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        payload: {
          status: status ?? null,
          runPhase: runPhase ?? null,
          title: stringOrNull((obj as { title?: unknown }).title) ?? null,
          error: error ?? null,
        },
      }
    }
    case IPC.AGENT_CHAT_ASSISTANT_DELTA: {
      const sessionId = stringOrNull(obj.sessionId)
      const messageId = stringOrNull((obj as { messageId?: unknown }).messageId)
      const text = stringOrNull((obj as { text?: unknown }).text)
      return {
        type: 'session.message.delta',
        ...(sessionId ? { sessionId } : {}),
        payload: {
          messageId: messageId ?? null,
          text: text ?? '',
        },
      }
    }
    case IPC.AGENT_CHAT_TRANSCRIPT_CHANGED:
      // Transcript flushes happen after optimistic user rows, tool updates, and final
      // persistence. Treating each flush as a turn completion makes iOS force-sync the
      // active history repeatedly and can replay the just-sent row as a duplicate.
      // Terminal state changes are already published from AGENT_CHAT_STATE_CHANGED.
      return null
    case IPC.AGENT_CHAT_CONTEXT_CHANGED:
      // Not currently surfaced to iPhone; skip until phone shows context usage.
      return null
    default:
      return null
  }
}

function blockingQuestionPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const requestId = stringOrNull(record.requestId)
  const questions = Array.isArray(record.questions) ? record.questions : null
  if (!requestId || !questions?.length) return null
  return {
    requestId,
    sessionId: stringOrNull(record.sessionId) ?? null,
    callId: stringOrNull(record.callId) ?? null,
    provider: stringOrNull(record.provider) ?? null,
    source: stringOrNull(record.source) ?? null,
    createdAt: stringOrNull(record.createdAt) ?? null,
    questions,
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
