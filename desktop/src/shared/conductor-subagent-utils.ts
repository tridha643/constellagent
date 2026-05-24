const SUBAGENT_TOOL_PATTERN = /^(task|taskcreate|subagent|explore|spawn_agent)$/i

export interface SubagentMetadata {
  readonly variant: 'subagent'
  readonly subagentType?: string
  readonly title?: string
  readonly model?: string
  readonly thinkingLevel?: string
  readonly agentId?: string
  readonly durationMs?: number
}

export function isSubagentTool(toolName: string): boolean {
  return SUBAGENT_TOOL_PATTERN.test(toolName.trim())
}

export function isSubagentToolCall(tool: { toolName: string; variant?: string }): boolean {
  if (tool.variant === 'subagent') return true
  return isSubagentTool(tool.toolName)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

function parseSubagentTypeField(input: Record<string, unknown>): string | undefined {
  const nested = input.subagentType ?? input.subagent_type
  if (typeof nested === 'string' && nested.trim()) {
    return nested.trim()
  }
  if (isRecord(nested)) {
    const kind = typeof nested.kind === 'string' ? nested.kind.trim() : undefined
    const name = typeof nested.name === 'string' ? nested.name.trim() : undefined
    if (kind && name) return `${kind}/${name}`
    return kind || name
  }
  if (typeof input.type === 'string' && input.type.trim()) {
    return input.type.trim()
  }
  return undefined
}

/** Maps a Cursor SDK internal `ToolCall` union member to a harness tool name. */
export function toolCallHarnessName(toolCall: unknown): string | undefined {
  if (!isRecord(toolCall)) return undefined
  const type = typeof toolCall.type === 'string' ? toolCall.type.trim() : undefined
  if (!type) return undefined
  if (type === 'task') return 'Task'
  if (isSubagentTool(type)) return type
  return undefined
}

export function parseSubagentInput(input: unknown): {
  title: string
  statusHint?: string
  subagentType?: string
  model?: string
} {
  if (!isRecord(input)) {
    if (typeof input === 'string' && input.trim()) {
      return { title: firstLine(input), statusHint: firstLine(input) }
    }
    return { title: 'Subagent' }
  }

  const description =
    typeof input.description === 'string' ? input.description.trim() : undefined
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : undefined
  const subagentType = parseSubagentTypeField(input)
  const model = typeof input.model === 'string' ? input.model.trim() : undefined

  const title = description || (prompt ? firstLine(prompt) : subagentType || 'Subagent')
  const statusHint = prompt ? firstLine(prompt) : description

  return { title, statusHint, subagentType, model }
}

export function subagentToolLabel(input: unknown): string {
  return parseSubagentInput(input).title
}

export function subagentStatusHint(input: unknown): string | undefined {
  const parsed = parseSubagentInput(input)
  if (parsed.statusHint && parsed.statusHint !== parsed.title) {
    return parsed.statusHint
  }
  if (parsed.subagentType) {
    return `Running ${parsed.subagentType}…`
  }
  return 'Exploring…'
}

export function parseSubagentResult(output: unknown): Pick<SubagentMetadata, 'agentId' | 'durationMs'> {
  if (!isRecord(output)) return {}
  const value = isRecord(output.value) ? output.value : output
  return {
    ...(typeof value.agentId === 'string' ? { agentId: value.agentId } : {}),
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
  }
}

export function buildSubagentMetadata(
  input: unknown,
  extras?: { model?: string; thinkingLevel?: string },
): string {
  const parsed = parseSubagentInput(input)
  const payload: SubagentMetadata = {
    variant: 'subagent',
    title: parsed.title,
    ...(parsed.subagentType ? { subagentType: parsed.subagentType } : {}),
    ...(parsed.model ? { model: parsed.model } : {}),
    ...(extras?.model ? { model: extras.model } : {}),
    ...(extras?.thinkingLevel ? { thinkingLevel: extras.thinkingLevel } : {}),
  }
  return JSON.stringify(payload)
}

export function mergeSubagentResultMetadata(
  existingMetadata: string | undefined,
  output: unknown,
): string {
  const base = parseSubagentMetadata(existingMetadata) ?? { variant: 'subagent' as const }
  const result = parseSubagentResult(output)
  return JSON.stringify({ ...base, ...result })
}

/** Parses Codex collab `spawn_agent` prompt text (plain or JSON) for subagent card metadata. */
export function parseCodexSpawnPrompt(prompt?: string): {
  title: string
  statusHint?: string
  subagentType?: string
} {
  const trimmed = prompt?.trim()
  if (!trimmed) return { title: 'Subagent' }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (isRecord(parsed)) {
        const subagentType =
          typeof parsed.agent_type === 'string'
            ? parsed.agent_type.trim()
            : typeof parsed.agentType === 'string'
              ? parsed.agentType.trim()
              : undefined
        const message =
          typeof parsed.message === 'string'
            ? parsed.message.trim()
            : typeof parsed.prompt === 'string'
              ? parsed.prompt.trim()
              : undefined
        if (message || subagentType) {
          const title = message ? firstLine(message) : subagentType ?? 'Subagent'
          return {
            title,
            statusHint: message ? firstLine(message) : undefined,
            ...(subagentType ? { subagentType } : {}),
          }
        }
      }
    } catch {
      // fall through to plain-text parsing
    }
  }

  return {
    title: firstLine(trimmed),
    statusHint: firstLine(trimmed),
  }
}

export function collabAgentStatusLabel(status: string): string {
  switch (status) {
    case 'pending_init':
      return 'Starting…'
    case 'running':
      return 'Running…'
    case 'completed':
      return 'Completed'
    case 'errored':
      return 'Failed'
    case 'shutdown':
      return 'Stopped'
    case 'interrupted':
      return 'Interrupted'
    case 'not_found':
      return 'Not found'
    default:
      return 'Working…'
  }
}

export function parseSubagentMetadata(metadata: string | undefined): SubagentMetadata | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as unknown
    if (isRecord(parsed) && parsed.variant === 'subagent') {
      return {
        variant: 'subagent',
        subagentType: typeof parsed.subagentType === 'string' ? parsed.subagentType : undefined,
        title: typeof parsed.title === 'string' ? parsed.title : undefined,
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
        thinkingLevel:
          typeof parsed.thinkingLevel === 'string' ? parsed.thinkingLevel : undefined,
        agentId: typeof parsed.agentId === 'string' ? parsed.agentId : undefined,
        durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
      }
    }
  } catch {
    // ignore
  }
  return null
}
