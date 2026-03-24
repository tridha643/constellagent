import { loadJsonFile, saveJsonFile, CLAUDE_CONFIG_PATH } from './claude-config'
import type { McpServer } from '../renderer/store/types'

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
