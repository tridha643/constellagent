import type { TranscriptMessage } from './pi/pi-desktop-state'
import type { ThinkingLevel } from './conductor-thinking'
import type {
  AgentChatRunPhase,
  ConductorBlockingQuestion,
} from './conductor-ask-question-types'

export type AgentProvider = 'codex' | 'cursor'

export const CONDUCTOR_PROVIDER_LABELS: Record<AgentProvider, string> = {
  cursor: 'Cursor',
  codex: 'Codex',
}
export type AgentChatStatus = 'idle' | 'running' | 'failed'

export type QueuedAgentMessageMode = 'followUp' | 'steer'

export interface QueuedAgentMessage {
  readonly id: string
  readonly mode: QueuedAgentMessageMode
  readonly text: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Serializable session state broadcast to the renderer (no transcript). */
export interface AgentChatSessionState {
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspacePath: string
  readonly title: string
  readonly provider: AgentProvider
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly plan: boolean
  readonly status: AgentChatStatus
  readonly runPhase?: AgentChatRunPhase
  readonly blockingQuestion?: ConductorBlockingQuestion | null
  readonly queuedMessages: readonly QueuedAgentMessage[]
  readonly error?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateAgentChatSessionInput {
  readonly workspaceId: string
  readonly workspacePath: string
  readonly provider: AgentProvider
  readonly model: string
  readonly title?: string
  readonly plan?: boolean
  readonly thinkingLevel?: ThinkingLevel
}

export interface ForkAgentChatSessionInput {
  readonly sourceSessionId: string
  readonly upToMessageId: string
  readonly title?: string
}

export interface AgentChatTranscriptPayload {
  readonly sessionId: string
  readonly transcript: readonly TranscriptMessage[]
}

export interface AgentChatDeltaPayload {
  readonly sessionId: string
  /** Stable id of the assistant message row receiving this delta. */
  readonly messageId: string
  readonly text: string
}

export interface AgentChatSessionWithTranscript {
  readonly state: AgentChatSessionState
  readonly transcript: readonly TranscriptMessage[]
}

export interface AgentProviderAuthStatus {
  readonly ready: boolean
  readonly detail: string
}

/** Sign-in state for Conductor providers (Settings + composer hints). */
export interface ConductorAuthStatus {
  readonly cursor: AgentProviderAuthStatus
  readonly codex: AgentProviderAuthStatus
}
