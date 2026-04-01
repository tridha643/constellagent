export type OrchestratorStatus = 'idle' | 'running' | 'error'

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
