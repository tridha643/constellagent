export type McpToolPolicyClassification =
  | 'read'
  | 'search'
  | 'inspect'
  | 'write'
  | 'destructive'
  | 'external-side-effect'
  | 'unknown'

export interface McpToolPolicyDecision {
  allowed: boolean
  classification: McpToolPolicyClassification
  serverName: string
  toolName: string
  reason: string
}

interface McpToolIdentity {
  serverName: string
  toolName: string
}

const UNKNOWN_SERVER = 'unknown MCP server'

const BUILT_IN_PLAN_TOOLS = new Set(['read', 'bash', 'grep', 'find', 'ls', 'write', 'edit', 'askUserQuestion'])

const READ_TOOL_NAMES = new Set([
  'get',
  'list',
  'read',
  'read_file',
  'read_files',
  'search',
  'status',
  'inspect',
  'cache_status',
])

const READ_TOOL_PREFIXES = [
  'get_',
  'list_',
  'read_',
  'search_',
  'inspect_',
  'describe_',
]

const WRITE_TOOL_RE = /(?:^|[_-])(?:write|edit|patch|apply|set|put|save|upload)(?:$|[_-])/
const DESTRUCTIVE_TOOL_RE = /(?:^|[_-])(?:delete|remove|rm|clear|reset|drop|destroy|truncate|clean|merge|commit|rebase|checkout)(?:$|[_-])/
const EXTERNAL_SIDE_EFFECT_TOOL_RE = /(?:^|[_-])(?:send|post|publish|deploy|notify|email|sms|message|comment|reply|create|update|submit|trigger|run|execute)(?:$|[_-])/

const SERVER_READ_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  cachebro: new Set(['read_file', 'read_files', 'cache_status']),
  filesystem: new Set(['read_file', 'read_multiple_files', 'list_directory', 'directory_tree', 'search_files', 'get_file_info']),
}

export function isBuiltInPlanModeTool(toolName: string): boolean {
  return BUILT_IN_PLAN_TOOLS.has(toolName)
}

function normalizeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function objectField(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  }
  return null
}

function parseMcpToolIdentity(rawToolName: string, eventLike: unknown): McpToolIdentity {
  const record = eventLike && typeof eventLike === 'object' ? eventLike as Record<string, unknown> : {}
  const input = objectField(record, ['input']) ?? {}
  const serverFromEvent = stringField(record, ['serverName', 'server', 'mcpServer', 'mcp_server'])
    ?? stringField(input, ['serverName', 'server', 'mcpServer', 'mcp_server'])
  const toolFromEvent = stringField(record, ['mcpToolName', 'tool', 'name'])
    ?? stringField(input, ['mcpToolName', 'tool'])

  if (serverFromEvent && toolFromEvent) {
    return { serverName: serverFromEvent, toolName: toolFromEvent }
  }

  const mcpDoubleUnderscore = rawToolName.match(/^mcp__(.+?)__(.+)$/)
  if (mcpDoubleUnderscore) {
    return { serverName: mcpDoubleUnderscore[1], toolName: mcpDoubleUnderscore[2] }
  }

  const dotIndex = rawToolName.indexOf('.')
  if (dotIndex > 0 && dotIndex < rawToolName.length - 1) {
    return {
      serverName: rawToolName.slice(0, dotIndex),
      toolName: rawToolName.slice(dotIndex + 1),
    }
  }

  return {
    serverName: serverFromEvent ?? UNKNOWN_SERVER,
    toolName: toolFromEvent ?? rawToolName,
  }
}

function extractAnnotations(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const direct = objectField(record, ['annotations'])
  if (direct) return direct
  const tool = objectField(record, ['tool'])
  const fromTool = tool ? objectField(tool, ['annotations']) : null
  if (fromTool) return fromTool
  const input = objectField(record, ['input'])
  const inputAnnotations = input ? objectField(input, ['annotations']) : null
  if (inputAnnotations) return inputAnnotations
  const meta = input ? objectField(input, ['_meta', 'meta']) : null
  return meta ? objectField(meta, ['annotations']) : null
}

function classificationFromAnnotations(annotations: Record<string, unknown> | null): McpToolPolicyClassification | null {
  if (!annotations) return null
  if (annotations.destructiveHint === true) return 'destructive'
  if (annotations.readOnlyHint === true) return 'read'
  if (annotations.openWorldHint === true) return 'external-side-effect'
  return null
}

function classificationFromName(serverName: string, toolName: string): McpToolPolicyClassification {
  const normalizedServer = normalizeName(serverName)
  const normalizedTool = normalizeName(toolName)
  if (SERVER_READ_ALLOWLIST[normalizedServer]?.has(normalizedTool)) return 'read'
  if (DESTRUCTIVE_TOOL_RE.test(normalizedTool)) return 'destructive'
  if (WRITE_TOOL_RE.test(normalizedTool)) return 'write'
  if (EXTERNAL_SIDE_EFFECT_TOOL_RE.test(normalizedTool)) return 'external-side-effect'
  if (READ_TOOL_NAMES.has(normalizedTool)) {
    if (normalizedTool.includes('search')) return 'search'
    if (normalizedTool.includes('inspect') || normalizedTool.includes('status')) return 'inspect'
    return 'read'
  }
  if (READ_TOOL_PREFIXES.some((prefix) => normalizedTool.startsWith(prefix))) {
    if (normalizedTool.startsWith('search_')) return 'search'
    if (normalizedTool.startsWith('inspect_') || normalizedTool.startsWith('describe_')) return 'inspect'
    return 'read'
  }
  return 'unknown'
}

function isPlanModeAllowedClassification(classification: McpToolPolicyClassification): boolean {
  return classification === 'read' || classification === 'search' || classification === 'inspect'
}

export function evaluatePlanModeMcpToolCall(rawToolName: string, eventLike?: unknown): McpToolPolicyDecision {
  const identity = parseMcpToolIdentity(rawToolName, eventLike)
  const annotations = extractAnnotations(eventLike)
  const classification = classificationFromAnnotations(annotations)
    ?? classificationFromName(identity.serverName, identity.toolName)
  const allowed = isPlanModeAllowedClassification(classification)
  const reason = allowed
    ? `Plan mode allows ${classification} MCP tools.`
    : classification === 'unknown'
      ? 'Plan mode denies MCP tools without read-only metadata or an explicit read/search/inspect allowlist match.'
      : `Plan mode denies ${classification} MCP tools.`

  return {
    allowed,
    classification,
    serverName: identity.serverName,
    toolName: identity.toolName,
    reason,
  }
}

export function formatMcpToolDenial(decision: McpToolPolicyDecision): string {
  return [
    `Plan mode blocked MCP tool "${decision.toolName}" from server "${decision.serverName}".`,
    decision.reason,
    'Switch to Work mode with /plan-off or /agent if this mutation is intended.',
  ].join(' ')
}
