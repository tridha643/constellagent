import type { PrInfo } from './github-types'

export type AutomationAgentType = 'claude-code' | 'codex' | 'gemini' | 'cursor' | 'opencode' | 'pi'

export type AgentEventType = 'agent:started' | 'agent:stopped' | 'agent:tool-used'
export type GitHubEventType =
  | 'pr:created'
  | 'pr:merged'
  | 'pr:checks-failed'
  | 'pr:checks-passed'
  | 'pr:approved'
  | 'pr:changes-requested'
  | 'pr:comments-received'
export type WorkspaceEventType = 'workspace:created' | 'workspace:deleted'
export type AutomationEventType = AgentEventType | GitHubEventType | WorkspaceEventType

export interface CronTrigger {
  type: 'cron'
  cronExpression: string
}

export interface EventTrigger {
  type: 'event'
  eventType: AutomationEventType
  filters?: AutomationFilter[]
}

export interface ManualTrigger {
  type: 'manual'
}

export type AutomationTrigger = CronTrigger | EventTrigger | ManualTrigger

export interface AgentTypeFilter {
  field: 'agentType'
  value: AutomationAgentType
}

export interface BranchPatternFilter {
  field: 'branch'
  pattern: string
}

export interface ToolNameFilter {
  field: 'toolName'
  value: string
}

export interface WorkspaceIdFilter {
  field: 'workspaceId'
  value: string
}

export type AutomationFilter =
  | AgentTypeFilter
  | BranchPatternFilter
  | ToolNameFilter
  | WorkspaceIdFilter

export interface RunPromptAction {
  type: 'run-prompt'
  prompt: string
}

export interface RunShellCommandAction {
  type: 'run-shell-command'
  command: string
}

export interface SendNotificationAction {
  type: 'send-notification'
  title: string
  body: string
}

export interface WriteToPtyAction {
  type: 'write-to-pty'
  workspaceId: string
  input: string
}

export type AutomationAction =
  | RunPromptAction
  | RunShellCommandAction
  | SendNotificationAction
  | WriteToPtyAction

export interface AutomationConfig {
  id: string
  name: string
  projectId: string
  prompt: string
  cronExpression: string
  enabled: boolean
  repoPath: string
  cooldownMs?: number
}

export interface AutomationConfigV2 {
  id: string
  name: string
  projectId: string
  trigger: AutomationTrigger
  action: AutomationAction
  enabled: boolean
  repoPath: string
  cooldownMs?: number
}

export type AutomationConfigLike = AutomationConfig | AutomationConfigV2

export interface AutomationEventMeta {
  automationOrigin?: string
  [key: string]: string | number | boolean | undefined
}

export interface AutomationEvent {
  type: AutomationEventType
  timestamp: number
  projectId?: string
  workspaceId?: string
  agentType?: AutomationAgentType
  branch?: string
  toolName?: string
  prInfo?: PrInfo
  meta?: AutomationEventMeta
}

export interface AutomationWorkspaceEvent {
  type: WorkspaceEventType
  workspaceId: string
  projectId: string
  branch?: string
  timestamp?: number
  meta?: AutomationEventMeta
}

export interface AutomationRunStartedEvent {
  automationId: string
  automationName: string
  projectId: string
  ptyId: string
  worktreePath: string
  branch: string
}

export type AutomationRunStatus = 'success' | 'failed' | 'timeout'

export interface AutomationStatusEvent {
  automationId: string
  status: AutomationRunStatus
  timestamp: number
  message?: string
}

export const DEFAULT_AUTOMATION_COOLDOWN_MS = 30_000
export const MAX_AUTOMATION_EXECUTIONS_PER_MINUTE = 10

export function isAutomationConfigV2(config: AutomationConfigLike): config is AutomationConfigV2 {
  return 'trigger' in config && 'action' in config
}

export function toAutomationConfigV2(config: AutomationConfigLike): AutomationConfigV2 {
  if (isAutomationConfigV2(config)) return config
  return {
    id: config.id,
    name: config.name,
    projectId: config.projectId,
    trigger: {
      type: 'cron',
      cronExpression: config.cronExpression,
    },
    action: {
      type: 'run-prompt',
      prompt: config.prompt,
    },
    enabled: config.enabled,
    repoPath: config.repoPath,
    cooldownMs: config.cooldownMs,
  }
}
