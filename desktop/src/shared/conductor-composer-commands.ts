import type { AgentProvider } from './agent-chat-types'

export type ConductorSlashCommandKind = 'host' | 'skill'

export type ConductorSlashPicker = 'personality' | 'dir-name' | 'file-path'

export interface ConductorSlashCommand {
  readonly id: string
  readonly command: string
  readonly description: string
  readonly kind: ConductorSlashCommandKind
  readonly picker?: ConductorSlashPicker
}

export interface ConductorSlashSection {
  readonly id: 'commands' | 'skills'
  readonly title?: string
  readonly items: readonly ConductorSlashCommand[]
}

export interface ConductorPersonalityOption {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly isDefault?: boolean
}

export interface HarnessSkillRecord {
  readonly name: string
  readonly description: string
  readonly sourcePath: string
}

export interface ActiveSlashToken {
  readonly query: string
  readonly from: number
  readonly to: number
}

export interface BuildConductorSlashSectionsOptions {
  readonly provider: AgentProvider
  readonly includeFast?: boolean
}

/** Detects a slash-command being typed at the cursor. */
export function parseActiveSlashToken(value: string, cursorPos: number): ActiveSlashToken | null {
  const end = Math.min(Math.max(0, cursorPos), value.length)
  const before = value.slice(0, end)
  const slashIdx = before.lastIndexOf('/')
  if (slashIdx < 0) {
    return null
  }
  if (slashIdx > 0) {
    const prev = value[slashIdx - 1]
    if (prev !== undefined && !/\s/.test(prev)) {
      return null
    }
  }
  const segment = value.slice(slashIdx, end)
  if (/\s/.test(segment)) {
    return null
  }
  return { query: segment, from: slashIdx, to: end }
}

export const CONDUCTOR_PERSONALITY_OPTIONS: readonly ConductorPersonalityOption[] = [
  {
    value: 'pragmatic',
    label: 'Pragmatic (default)',
    description: 'Concise, task-focused, and direct',
    isDefault: true,
  },
  {
    value: 'friendly',
    label: 'Friendly',
    description: 'Warm, collaborative, and helpful',
  },
  {
    value: 'none',
    label: 'None',
    description: 'No personality instructions',
  },
] as const

const CONDUCTOR_HOST_COMMANDS: readonly ConductorSlashCommand[] = [
  {
    id: 'host:clear',
    command: '/clear',
    description: 'Close this tab and start a fresh chat',
    kind: 'host',
  },
  {
    id: 'host:restart',
    command: '/restart',
    description: 'Restart the agent process. Useful to pick up config changes.',
    kind: 'host',
  },
  {
    id: 'host:add-dir',
    command: '/add-dir',
    description: 'Link a directory or workspace',
    kind: 'host',
    picker: 'dir-name',
  },
  {
    id: 'host:add-file',
    command: '/add-file',
    description: 'Link a file into the session',
    kind: 'host',
    picker: 'file-path',
  },
  {
    id: 'host:personality',
    command: '/personality',
    description: "Choose Codex's personality for this session and future ones",
    kind: 'host',
    picker: 'personality',
  },
  {
    id: 'host:mcp-status',
    command: '/mcp-status',
    description: 'View MCP server connection status',
    kind: 'host',
  },
  {
    id: 'host:mcp',
    command: '/mcp',
    description: 'Manage MCP servers (opens terminal)',
    kind: 'host',
  },
  {
    id: 'host:compact',
    command: '/compact',
    description: 'Compact the context window',
    kind: 'host',
  },
  {
    id: 'host:plan',
    command: '/plan',
    description: 'Enter plan mode',
    kind: 'host',
  },
  {
    id: 'host:fast',
    command: '/fast',
    description: 'Enable fast mode (uses credits 2x faster)',
    kind: 'host',
  },
] as const

export function getConductorHostCommands(
  options: BuildConductorSlashSectionsOptions,
): readonly ConductorSlashCommand[] {
  return CONDUCTOR_HOST_COMMANDS.filter((command) => {
    if (command.picker === 'personality' && options.provider !== 'codex') {
      return false
    }
    if (
      (command.command === '/add-dir' || command.command === '/add-file') &&
      options.provider !== 'codex'
    ) {
      return false
    }
    if (command.command === '/fast' && !options.includeFast) {
      return false
    }
    return true
  })
}

/** First sentence only — used for compact skill rows in the slash menu. */
export function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const line = trimmed.split(/\r?\n/)[0]?.trim() ?? trimmed
  const match = line.match(/^(.+?[.!?])(?:\s|$)/)
  if (match?.[1]) return match[1].trim()
  if (line.length <= 120) return line
  return `${line.slice(0, 117).trimEnd()}…`
}

/** Slash commands forwarded to the harness without Conductor prompt wrapping. */
export function isHarnessSlashCommand(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return false
  if (/\n/.test(trimmed)) return false
  return /^\/[^\s]+(?:\s+\S+)*$/.test(trimmed)
}

export function harnessSkillsToSlashCommands(
  skills: readonly HarnessSkillRecord[],
): readonly ConductorSlashCommand[] {
  return skills.map((skill) => ({
    id: `skill:${skill.name}`,
    command: `/${skill.name}`,
    description: firstSentence(skill.description) || 'Skill',
    kind: 'skill' as const,
  }))
}

function matchesSlashQuery(command: ConductorSlashCommand, normalizedQuery: string): boolean {
  if (!normalizedQuery.startsWith('/')) {
    return false
  }
  if (normalizedQuery === '/') {
    return true
  }
  const cmd = command.command.toLowerCase()
  if (!cmd.startsWith(normalizedQuery)) {
    return false
  }
  if (
    cmd.length > normalizedQuery.length &&
    cmd[normalizedQuery.length] === '-' &&
    !normalizedQuery.includes('-', 1)
  ) {
    return false
  }
  return true
}

export function buildConductorSlashSections(
  query: string,
  hostCommands: readonly ConductorSlashCommand[],
  skillCommands: readonly ConductorSlashCommand[],
): readonly ConductorSlashSection[] {
  const normalizedQuery = query.trim().toLowerCase()
  const commandMatches = hostCommands.filter((command) => matchesSlashQuery(command, normalizedQuery))
  const skillMatches = skillCommands.filter((command) => matchesSlashQuery(command, normalizedQuery))

  const sections: ConductorSlashSection[] = []
  if (commandMatches.length > 0) {
    sections.push({ id: 'commands', items: commandMatches })
  }
  if (skillMatches.length > 0) {
    sections.push({ id: 'skills', title: 'Skills', items: skillMatches })
  }
  return sections
}

export function flattenConductorSlashSections(
  sections: readonly ConductorSlashSection[],
): readonly ConductorSlashCommand[] {
  return sections.flatMap((section) => section.items)
}

const CONDUCTOR_HOST_SLASH_NAMES = new Set(
  CONDUCTOR_HOST_COMMANDS.map((command) => command.command.slice(1).toLowerCase()),
)

/** True when `name` is a built-in Conductor host slash command (not a harness skill). */
export function isConductorHostSlashName(name: string): boolean {
  return CONDUCTOR_HOST_SLASH_NAMES.has(name.trim().toLowerCase())
}
