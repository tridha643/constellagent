export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type TaskAutoClearMode = 'never' | 'on_list_complete' | 'on_task_complete'
export type TaskScope = 'memory' | 'session' | 'workspace'

export interface Task {
  id: string
  subject: string
  description: string
  status: TaskStatus
  activeForm?: string
  owner?: string
  metadata: Record<string, unknown>
  blocks: string[]
  blockedBy: string[]
  output: string[]
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  stoppedAt?: number
  lastError?: string
}

export interface TaskStoreData {
  schemaVersion: 1
  nextId: number
  tasks: Task[]
}

export interface TasksConfig {
  taskScope?: TaskScope
  autoCascade?: boolean
  autoClearCompleted?: TaskAutoClearMode
}

export interface TaskRuntimeState {
  activeTaskIds: string[]
  activePidByTaskId: Record<string, number>
  tokensByTaskId: Record<string, { input: number; output: number }>
  currentTurn: number
  lastTaskToolTurn: number
  reminderInjectedThisCycle: boolean
  batchCompletedTurn?: number
  completedTurnByTaskId?: Record<string, number>
}

export interface TaskStoreContext {
  workspaceId: string | null
  sessionId: string
  cwd: string
}

export interface ResolvedTaskStore {
  mode: 'memory' | 'file'
  memoryKey: string | null
  filePath: string | null
  lockPath: string | null
  configPath: string | null
  rootPath: string | null
}

export interface TaskWarning {
  type: 'missing' | 'self' | 'cycle'
  message: string
}

export interface TaskCreateParams {
  subject: string
  description: string
  activeForm?: string
  agentType?: string
  metadata?: Record<string, unknown>
}

export interface TaskUpdateParams {
  taskId: string
  status?: TaskStatus | 'deleted'
  subject?: string
  description?: string
  activeForm?: string
  owner?: string
  metadata?: Record<string, unknown | null>
  addBlocks?: string[]
  addBlockedBy?: string[]
}

export interface TaskOutputParams {
  task_id: string
  block?: boolean
  timeout?: number
}

export interface TaskExecuteParams {
  task_ids: string[]
  additional_context?: string
  model?: string
  max_turns?: number
}

export interface TaskStopParams {
  task_id?: string
  shell_id?: string
}

export interface BackgroundProcess {
  taskId: string
  pid: number
  command: string
  output: string[]
  status: 'running' | 'completed' | 'error' | 'stopped'
  startedAt: number
  completedAt?: number
  exitCode?: number | null
  lastError?: string
}

export interface TaskCommandAction {
  label: string
  value: string
  description?: string
}
