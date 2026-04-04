export type OrchestratorStatus = 'idle' | 'running' | 'error'

/** Default OpenRouter model slug for orchestrator planning. */
export const DEFAULT_ORCHESTRATOR_MODEL = 'moonshotai/kimi-k2.5'

export interface OrchestratorLlmCredentials {
  openRouterApiKey: string
  orchestratorModel: string
}

/** Payload from the renderer when sending an orchestrator command over IPC. */
export interface OrchestratorCommandPayload extends OrchestratorLlmCredentials {
  command: string
}

export interface OrchestratorMessage {
  id: string
  direction: 'inbound' | 'outbound' | 'system'
  content: string
  timestamp: number
  sessionId?: string
}

export interface OrchestratorSession {
  id: string
  workspaceId: string
  worktreePath: string
  branch: string
  task: string
  status: 'pending' | 'running' | 'done' | 'failed'
  startedAt: number
}

export interface SendBlueStatus {
  connected: boolean
  webhookUrl: string | null
  phoneNumber: string | null
}
