const SUBAGENT_TOOL_PATTERN = /^(task|taskcreate|subagent|explore)$/i

export interface SubagentMetadata {
  readonly variant: 'subagent'
  readonly subagentType?: string
  readonly title?: string
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

export function parseSubagentInput(input: unknown): {
  title: string
  statusHint?: string
  subagentType?: string
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
  const subagentType =
    typeof input.subagent_type === 'string'
      ? input.subagent_type
      : typeof input.subagentType === 'string'
        ? input.subagentType
        : typeof input.type === 'string'
          ? input.type
          : undefined

  const title = description || (prompt ? firstLine(prompt) : subagentType || 'Subagent')
  const statusHint = prompt ? firstLine(prompt) : description

  return { title, statusHint, subagentType }
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

export function buildSubagentMetadata(
  input: unknown,
  extras?: { model?: string; thinkingLevel?: string },
): string {
  const parsed = parseSubagentInput(input)
  const payload: SubagentMetadata & { model?: string; thinkingLevel?: string } = {
    variant: 'subagent',
    title: parsed.title,
    ...(parsed.subagentType ? { subagentType: parsed.subagentType } : {}),
    ...(extras?.model ? { model: extras.model } : {}),
    ...(extras?.thinkingLevel ? { thinkingLevel: extras.thinkingLevel } : {}),
  }
  return JSON.stringify(payload)
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
      }
    }
  } catch {
    // ignore
  }
  return null
}
