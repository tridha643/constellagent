import { mkdir } from 'fs/promises'
import { loadJsonFile, saveJsonFile, CLAUDE_CONFIG_PATH } from './claude-config'
import { CODEX_DIR, loadCodexConfigText, saveCodexConfigText } from './codex-config'
import type { McpServer, AgentMcpAssignments } from '../renderer/store/types'

interface ClaudeMcpEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

/** Read all MCP servers from ~/.claude.json mcpServers key */
export async function loadMcpServersFromConfig(): Promise<McpServer[]> {
  const config = await loadJsonFile<Record<string, unknown>>(CLAUDE_CONFIG_PATH, {})
  const raw = config.mcpServers as Record<string, ClaudeMcpEntry> | undefined
  if (!raw || typeof raw !== 'object') return []

  return Object.entries(raw).map(([name, entry]) => ({
    id: name, // use name as stable ID
    name,
    command: entry.command ?? '',
    args: entry.args ?? [],
    ...(entry.env && Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
  }))
}

/** Remove a server by name from ~/.claude.json */
export async function removeServerFromConfig(serverName: string): Promise<void> {
  const config = await loadJsonFile<Record<string, unknown>>(CLAUDE_CONFIG_PATH, {})
  const raw = config.mcpServers as Record<string, unknown> | undefined
  if (raw && serverName in raw) {
    delete raw[serverName]
    if (Object.keys(raw).length === 0) delete config.mcpServers
    await saveJsonFile(CLAUDE_CONFIG_PATH, config)
  }
}

export async function writeClaudeCodeMcpConfig(servers: McpServer[]): Promise<void> {
  const config = await loadJsonFile<Record<string, unknown>>(CLAUDE_CONFIG_PATH, {})
  if (servers.length === 0) {
    delete config.mcpServers
  } else {
    const mcpServers: Record<string, ClaudeMcpEntry> = {}
    for (const s of servers) {
      const entry: ClaudeMcpEntry = { command: s.command, args: s.args }
      if (s.env && Object.keys(s.env).length > 0) entry.env = s.env
      mcpServers[s.name] = entry
    }
    config.mcpServers = mcpServers
  }
  await saveJsonFile(CLAUDE_CONFIG_PATH, config)
}

export async function writeCodexMcpConfig(servers: McpServer[]): Promise<void> {
  let config = await loadCodexConfigText()

  // Remove existing [mcp_servers.*] blocks
  config = config.replace(/\[mcp_servers\.[^\]]+\]\n(?:[^\[]*(?:\n|$))*/g, '')
  config = config.replace(/\n{3,}/g, '\n\n').trimEnd()

  if (servers.length > 0) {
    const blocks = servers.map((s) => {
      const lines = [`[mcp_servers.${s.name}]`]
      lines.push(`command = "${s.command}"`)
      if (s.args.length > 0) {
        const argsStr = s.args.map((a) => `"${a}"`).join(', ')
        lines.push(`args = [${argsStr}]`)
      }
      if (s.env && Object.keys(s.env).length > 0) {
        lines.push('')
        lines.push(`[mcp_servers.${s.name}.env]`)
        for (const [k, v] of Object.entries(s.env)) {
          lines.push(`${k} = "${v}"`)
        }
      }
      return lines.join('\n')
    })

    if (config) config += '\n\n'
    config += blocks.join('\n\n')
  }

  if (config && !config.endsWith('\n')) config += '\n'
  await mkdir(CODEX_DIR, { recursive: true })
  await saveCodexConfigText(config)
}

async function writeJsonMcpConfig(configPath: string, dirPath: string, servers: McpServer[]): Promise<void> {
  await mkdir(dirPath, { recursive: true })
  const config = await loadJsonFile<Record<string, unknown>>(configPath, {})
  if (servers.length === 0) {
    delete config.mcpServers
  } else {
    const mcpServers: Record<string, ClaudeMcpEntry> = {}
    for (const s of servers) {
      const entry: ClaudeMcpEntry = { command: s.command, args: s.args }
      if (s.env && Object.keys(s.env).length > 0) entry.env = s.env
      mcpServers[s.name] = entry
    }
    config.mcpServers = mcpServers
  }
  await saveJsonFile(configPath, config)
}

export async function syncMcpConfigs(
  mcpServers: McpServer[],
  assignments: AgentMcpAssignments,
): Promise<void> {
  const { homedir } = await import('os')
  const { join } = await import('path')
  const home = homedir()

  const serverMap = new Map(mcpServers.map((s) => [s.id, s]))

  const getServers = (agent: string) =>
    (assignments[agent as keyof AgentMcpAssignments] ?? [])
      .map((id) => serverMap.get(id))
      .filter((s): s is McpServer => !!s)

  const geminiDir = join(home, '.gemini')
  const cursorDir = join(home, '.cursor')

  await Promise.all([
    writeClaudeCodeMcpConfig(getServers('claude-code')),
    writeCodexMcpConfig(getServers('codex')),
    writeJsonMcpConfig(join(geminiDir, 'settings.json'), geminiDir, getServers('gemini')),
    writeJsonMcpConfig(join(cursorDir, 'mcp.json'), cursorDir, getServers('cursor')),
  ])
}
