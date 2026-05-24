import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { AgentProvider } from '../shared/agent-chat-types'
import { cliEnvWithStandardPath } from './cli-env'
import { resolveCodexCliPath } from './agents/codex-driver'

const execFileAsync = promisify(execFile)

export interface McpServerStatus {
  name: string
  status: 'ok' | 'error' | 'unknown'
  detail?: string
}

export interface McpProbeResult {
  servers: McpServerStatus[]
  probedAt: number
}

function parseCodexMcpList(stdout: string): McpServerStatus[] {
  const servers: McpServerStatus[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || /^[-=]+$/.test(trimmed)) continue
    if (/no mcp servers configured/i.test(trimmed)) continue

    const bracketMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (bracketMatch) {
      servers.push({
        name: bracketMatch[1]!.trim(),
        status: 'ok',
        detail: bracketMatch[2]?.trim() || undefined,
      })
      continue
    }

    const parts = trimmed.split(/\s{2,}|\t+/).filter(Boolean)
    if (parts.length >= 1) {
      const name = parts[0]!.replace(/^[-*]\s*/, '').trim()
      if (!name || name.toLowerCase() === 'name') continue
      const statusText = (parts[1] ?? '').toLowerCase()
      servers.push({
        name,
        status: statusText.includes('error') || statusText.includes('fail') ? 'error' : 'ok',
        detail: parts.slice(1).join(' ').trim() || undefined,
      })
    }
  }
  return servers
}

async function readJsonServerNames(configPath: string): Promise<string[]> {
  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const servers =
      (parsed.mcpServers as Record<string, unknown> | undefined) ??
      (parsed.servers as Record<string, unknown> | undefined) ??
      parsed
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      return []
    }
    return Object.keys(servers)
  } catch {
    return []
  }
}

async function probeCodex(workspacePath: string): Promise<McpServerStatus[]> {
  const codexBin = resolveCodexCliPath()
  if (!codexBin) {
    return []
  }
  try {
    const { stdout } = await execFileAsync(codexBin, ['mcp', 'list'], {
      cwd: workspacePath,
      env: cliEnvWithStandardPath(),
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    })
    return parseCodexMcpList(stdout)
  } catch (err) {
    const stdout =
      err && typeof err === 'object' && 'stdout' in err && typeof (err as { stdout?: unknown }).stdout === 'string'
        ? (err as { stdout: string }).stdout
        : ''
    const parsed = parseCodexMcpList(stdout)
    if (parsed.length > 0) {
      return parsed
    }
    return []
  }
}

async function probeCursor(): Promise<McpServerStatus[]> {
  const configPath = join(homedir(), '.cursor', 'mcp.json')
  const names = await readJsonServerNames(configPath)
  return names.map((name) => ({ name, status: 'unknown' as const }))
}

export async function probeMcpStatus(
  provider: AgentProvider,
  workspacePath: string,
): Promise<McpProbeResult> {
  let servers: McpServerStatus[] = []
  if (provider === 'codex') {
    servers = await probeCodex(workspacePath)
  } else if (provider === 'cursor') {
    servers = await probeCursor()
  }

  return {
    servers,
    probedAt: Date.now(),
  }
}

export { parseCodexMcpList }
