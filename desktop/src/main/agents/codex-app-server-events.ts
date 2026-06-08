import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk'

export interface CodexAppServerEventMapperState {
  readonly textByItemId: Map<string, string>
  readonly startedItemIds: Set<string>
  threadId: string | null
  activeTurnId: string | null
  lastTokenUsage: {
    inputTokens: number
    cachedInputTokens: number
  } | null
}

export function createCodexAppServerEventMapperState(): CodexAppServerEventMapperState {
  return {
    textByItemId: new Map(),
    startedItemIds: new Set(),
    threadId: null,
    activeTurnId: null,
    lastTokenUsage: null,
  }
}

export function mapAppServerNotification(
  method: string,
  params: unknown,
  state: CodexAppServerEventMapperState,
): ThreadEvent[] {
  const record = isRecord(params) ? params : {}
  switch (method) {
    case 'thread/started':
      state.threadId = stringField(record.threadId) ?? state.threadId
      return state.threadId ? [{ type: 'thread.started', thread_id: state.threadId }] : []
    case 'turn/started':
      state.activeTurnId = stringField(record.turnId) ?? extractTurnId(record.turn) ?? state.activeTurnId
      return [{ type: 'turn.started' }]
    case 'turn/completed':
      return [
        {
          type: 'turn.completed',
          usage: tokenUsageForTurnCompleted(state),
        },
      ]
    case 'turn/failed':
      return [
        {
          type: 'turn.failed',
          error: {
            message: extractTurnErrorMessage(record.turn) ?? 'Codex turn failed',
          },
        },
      ]
    case 'error':
      return [{ type: 'error', message: stringField(record.message) ?? 'Codex error' }]
    case 'thread/tokenUsage/updated':
      state.lastTokenUsage = parseTokenUsage(record.tokenUsage)
      return []
    case 'item/agentMessage/delta':
    case 'constellagent/event/agent_message_content_delta':
    case 'constellagent/event/agent_message_delta':
      return mapTextDeltaEvents(state, record, 'agent_message')
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return mapTextDeltaEvents(state, record, 'reasoning')
    case 'item/started':
    case 'constellagent/event/item_started':
      return mapItemLifecycleEvent(state, record.item, 'item.started')
    case 'item/updated':
      return mapItemLifecycleEvent(state, record.item, 'item.updated')
    case 'item/completed':
    case 'constellagent/event/item_completed':
    case 'constellagent/event/agent_message':
      return mapItemLifecycleEvent(state, record.item ?? record, 'item.completed')
    case 'item/commandExecution/outputDelta':
    case 'item/command_execution/outputDelta':
      return mapCommandExecutionOutputDelta(state, record)
    default:
      return []
  }
}

export function mapAppServerThreadItem(item: unknown): ThreadItem | null {
  if (!isRecord(item) || typeof item.id !== 'string') return null
  const type = typeof item.type === 'string' ? item.type : ''

  switch (type) {
    case 'agentMessage':
      return {
        id: item.id,
        type: 'agent_message',
        text: stringField(item.text) ?? '',
      }
    case 'reasoning':
      return {
        id: item.id,
        type: 'reasoning',
        text: reasoningText(item),
      }
    case 'commandExecution':
      return {
        id: item.id,
        type: 'command_execution',
        command: stringField(item.command) ?? '',
        aggregated_output: stringField(item.aggregatedOutput) ?? undefined,
        exit_code: typeof item.exitCode === 'number' ? item.exitCode : undefined,
        status: mapCommandStatus(item.status),
      }
    case 'mcpToolCall':
      return {
        id: item.id,
        type: 'mcp_tool_call',
        server: stringField(item.server) ?? '',
        tool: stringField(item.tool) ?? '',
        arguments: item.arguments,
        result: item.result,
        error: isRecord(item.error) ? { message: stringField(item.error.message) ?? '' } : undefined,
        status: mapMcpStatus(item.status),
      }
    case 'fileChange':
      return {
        id: item.id,
        type: 'file_change',
        changes: item.changes,
        status: mapGenericStatus(item.status),
      }
    case 'webSearch':
      return {
        id: item.id,
        type: 'web_search',
        query: stringField(item.query) ?? '',
      }
    case 'todoList':
      return {
        id: item.id,
        type: 'todo_list',
        items: Array.isArray(item.items) ? item.items : [],
      }
    case 'collabAgentToolCall':
      return mapCollabItem(item)
    case 'dynamicToolCall':
      return {
        id: item.id,
        type: 'mcp_tool_call',
        server: stringField(item.namespace) ?? 'dynamic',
        tool: stringField(item.tool) ?? 'dynamic_tool',
        arguments: item.arguments,
        result: item.contentItems,
        status: mapMcpStatus(item.status),
      }
    default:
      return null
  }
}

function mapItemLifecycleEvent(
  state: CodexAppServerEventMapperState,
  rawItem: unknown,
  eventType: 'item.started' | 'item.updated' | 'item.completed',
): ThreadEvent[] {
  const mapped = mapAppServerThreadItem(rawItem)
  if (!mapped) return []
  const events: ThreadEvent[] = []
  if (eventType === 'item.started' && !state.startedItemIds.has(mapped.id)) {
    state.startedItemIds.add(mapped.id)
    events.push({ type: 'item.started', item: mapped })
    return events
  }
  if (eventType === 'item.completed' && !state.startedItemIds.has(mapped.id)) {
    state.startedItemIds.add(mapped.id)
    events.push({ type: 'item.started', item: mapped })
  }
  events.push({ type: eventType, item: mapped })
  return events
}

function mapTextDeltaEvents(
  state: CodexAppServerEventMapperState,
  record: Record<string, unknown>,
  itemType: 'agent_message' | 'reasoning',
): ThreadEvent[] {
  const itemId = stringField(record.itemId) ?? stringField(record.id)
  const delta = stringField(record.delta) ?? stringField(record.text) ?? ''
  if (!itemId || !delta) return []

  const previous = state.textByItemId.get(itemId) ?? ''
  const text = previous + delta
  state.textByItemId.set(itemId, text)

  const item = {
    id: itemId,
    type: itemType,
    text,
  } as ThreadItem

  const events: ThreadEvent[] = []
  if (!state.startedItemIds.has(itemId)) {
    state.startedItemIds.add(itemId)
    events.push({ type: 'item.started', item })
  }
  events.push({ type: 'item.updated', item })
  return events
}

function mapCommandExecutionOutputDelta(
  state: CodexAppServerEventMapperState,
  record: Record<string, unknown>,
): ThreadEvent[] {
  const itemId = stringField(record.itemId) ?? stringField(record.id)
  const delta = stringField(record.delta) ?? stringField(record.output) ?? ''
  if (!itemId) return []

  const previous = state.textByItemId.get(itemId) ?? ''
  const aggregated_output = previous + delta
  state.textByItemId.set(itemId, aggregated_output)

  const item = {
    id: itemId,
    type: 'command_execution',
    command: stringField(record.command) ?? '',
    aggregated_output,
    status: 'in_progress',
  } as ThreadItem

  const events: ThreadEvent[] = []
  if (!state.startedItemIds.has(itemId)) {
    state.startedItemIds.add(itemId)
    events.push({ type: 'item.started', item })
  }
  events.push({ type: 'item.updated', item })
  return events
}

function mapCollabItem(item: Record<string, unknown>): ThreadItem | null {
  const tool = mapCollabTool(item.tool)
  if (!tool) return null
  const agents_states: Record<string, { status: string; message?: string }> = {}
  if (isRecord(item.agentsStates)) {
    for (const [key, value] of Object.entries(item.agentsStates)) {
      if (!isRecord(value)) continue
      const status = mapCollabAgentStatus(value.status)
      if (!status) continue
      const message = stringField(value.message)
      agents_states[key] = message ? { status, message } : { status }
    }
  }
  return {
    id: item.id as string,
    type: 'collab_tool_call',
    tool,
    sender_thread_id: stringField(item.senderThreadId) ?? '',
    receiver_thread_ids: Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
    prompt: stringField(item.prompt),
    agents_states,
    status: mapCollabStatus(item.status),
  } as unknown as ThreadItem
}

function tokenUsageForTurnCompleted(state: CodexAppServerEventMapperState): {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
} {
  const usage = state.lastTokenUsage
  return {
    input_tokens: usage?.inputTokens ?? 0,
    cached_input_tokens: usage?.cachedInputTokens ?? 0,
    output_tokens: 0,
  }
}

function parseTokenUsage(value: unknown): CodexAppServerEventMapperState['lastTokenUsage'] {
  if (!isRecord(value)) return null
  const total = isRecord(value.total) ? value.total : isRecord(value.last) ? value.last : value
  const inputTokens = numberField(total.inputTokens) ?? 0
  const cachedInputTokens = numberField(total.cachedInputTokens) ?? 0
  return { inputTokens, cachedInputTokens }
}

function reasoningText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content.filter((entry) => typeof entry === 'string').join('\n') : ''
  const summary = Array.isArray(item.summary) ? item.summary.filter((entry) => typeof entry === 'string').join('\n') : ''
  return [summary, content].filter(Boolean).join('\n')
}

function extractTurnId(turn: unknown): string | null {
  if (!isRecord(turn)) return null
  return stringField(turn.id) ?? stringField(turn.turnId)
}

function extractTurnErrorMessage(turn: unknown): string | null {
  if (!isRecord(turn)) return null
  const error = turn.error
  if (typeof error === 'string') return error
  if (isRecord(error)) return stringField(error.message)
  return null
}

function mapCommandStatus(value: unknown): 'in_progress' | 'completed' | 'failed' {
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  return 'in_progress'
}

function mapMcpStatus(value: unknown): 'in_progress' | 'completed' | 'failed' {
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  return 'in_progress'
}

function mapGenericStatus(value: unknown): 'in_progress' | 'completed' | 'failed' {
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  return 'in_progress'
}

function mapCollabStatus(value: unknown): 'in_progress' | 'completed' | 'failed' {
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  return 'in_progress'
}

function mapCollabTool(value: unknown): 'spawn_agent' | 'wait' | 'send_input' | 'close_agent' | null {
  switch (value) {
    case 'spawnAgent':
      return 'spawn_agent'
    case 'wait':
      return 'wait'
    case 'sendInput':
      return 'send_input'
    case 'closeAgent':
      return 'close_agent'
    default:
      return null
  }
}

function mapCollabAgentStatus(value: unknown): string | null {
  switch (value) {
    case 'pendingInit':
      return 'pending_init'
    case 'running':
      return 'running'
    case 'interrupted':
      return 'interrupted'
    case 'completed':
      return 'completed'
    case 'errored':
      return 'errored'
    case 'shutdown':
      return 'shutdown'
    case 'notFound':
      return 'not_found'
    default:
      return typeof value === 'string' ? value : null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
