/** Wire types for Codex exec `collab_tool_call` items (SDK types may lag the CLI). */

export type CollabTool = 'spawn_agent' | 'wait' | 'send_input' | 'close_agent'

export type CollabToolCallStatus = 'in_progress' | 'completed' | 'failed'

export type CollabAgentStatus =
  | 'pending_init'
  | 'running'
  | 'interrupted'
  | 'completed'
  | 'errored'
  | 'shutdown'
  | 'not_found'

export interface CollabAgentState {
  readonly status: CollabAgentStatus
  readonly message?: string
}

export interface CollabToolCallItem {
  readonly id: string
  readonly type: 'collab_tool_call'
  readonly tool: CollabTool
  readonly sender_thread_id: string
  readonly receiver_thread_ids: readonly string[]
  readonly prompt?: string
  readonly agents_states: Readonly<Record<string, CollabAgentState>>
  readonly status: CollabToolCallStatus
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const COLLAB_TOOLS = new Set<CollabTool>(['spawn_agent', 'wait', 'send_input', 'close_agent'])
const COLLAB_STATUSES = new Set<CollabToolCallStatus>(['in_progress', 'completed', 'failed'])
const AGENT_STATUSES = new Set<CollabAgentStatus>([
  'pending_init',
  'running',
  'interrupted',
  'completed',
  'errored',
  'shutdown',
  'not_found',
])

function parseCollabAgentState(value: unknown): CollabAgentState | null {
  if (!isRecord(value)) return null
  const status = value.status
  if (typeof status !== 'string' || !AGENT_STATUSES.has(status as CollabAgentStatus)) {
    return null
  }
  const message = typeof value.message === 'string' ? value.message : undefined
  return { status: status as CollabAgentStatus, ...(message ? { message } : {}) }
}

export function isCollabToolCallItem(item: unknown): item is CollabToolCallItem {
  if (!isRecord(item)) return false
  if (item.type !== 'collab_tool_call') return false
  if (typeof item.id !== 'string') return false
  if (typeof item.tool !== 'string' || !COLLAB_TOOLS.has(item.tool as CollabTool)) return false
  if (typeof item.sender_thread_id !== 'string') return false
  if (!Array.isArray(item.receiver_thread_ids)) return false
  if (typeof item.status !== 'string' || !COLLAB_STATUSES.has(item.status as CollabToolCallStatus)) {
    return false
  }
  if (item.prompt !== undefined && typeof item.prompt !== 'string') return false
  if (!isRecord(item.agents_states)) return false
  for (const state of Object.values(item.agents_states)) {
    if (!parseCollabAgentState(state)) return false
  }
  return true
}

export function isCollabAgentTerminal(status: CollabAgentStatus): boolean {
  return status === 'completed' || status === 'errored' || status === 'shutdown' || status === 'interrupted' || status === 'not_found'
}

export function collabAgentSucceeded(status: CollabAgentStatus): boolean {
  return status === 'completed'
}
