import { readFile } from 'fs/promises'
import { join, basename } from 'path'
import { getAgentFS } from './agentfs-service'

export interface SkillInfo {
  name: string
  description: string
}

export interface SubagentInfo {
  name: string
  description: string
  tools?: string
}

function parseYamlFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key && val) result[key] = val
  }
  return result
}

export class SkillsService {
  static async scanSkillDir(skillPath: string): Promise<SkillInfo | null> {
    const skillMdPath = join(skillPath, 'SKILL.md')
    try {
      const content = await readFile(skillMdPath, 'utf-8')
      const frontmatter = parseYamlFrontmatter(content)
      return {
        name: frontmatter.name || basename(skillPath),
        description: frontmatter.description || '',
      }
    } catch {
      return null
    }
  }

  static async scanSubagentFile(filePath: string): Promise<SubagentInfo | null> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const frontmatter = parseYamlFrontmatter(content)
      return {
        name: frontmatter.name || basename(filePath, '.md'),
        description: frontmatter.description || '',
        tools: frontmatter.tools || undefined,
      }
    } catch {
      return null
    }
  }

  /** Body (system prompt) and optional model from a subagent markdown file. */
  static async readSubagentDefinition(
    filePath: string,
  ): Promise<{ description: string; prompt: string; model?: string } | null> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const frontmatter = parseYamlFrontmatter(content)
      const prompt = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
      return {
        description: frontmatter.description || '',
        prompt,
        model: frontmatter.model || undefined,
      }
    } catch {
      return null
    }
  }

  // ── AgentFS KV persistence ──

  static async saveSkillToKV(projectPath: string, skill: { name: string; description: string; sourcePath: string; enabled: boolean }): Promise<void> {
    try {
      const agent = await getAgentFS(projectPath)
      await agent.kv.set(`skill:${skill.name}`, skill)
    } catch { /* best-effort */ }
  }

  static async removeSkillFromKV(projectPath: string, skillName: string): Promise<void> {
    try {
      const agent = await getAgentFS(projectPath)
      await agent.kv.delete(`skill:${skillName}`)
    } catch { /* best-effort */ }
  }

  static async listSkillsFromKV(projectPath: string): Promise<Array<{ name: string; description: string; sourcePath: string; enabled: boolean }>> {
    try {
      const agent = await getAgentFS(projectPath)
      const entries = await agent.kv.list('skill:')
      return entries.map((e) => e.value)
    } catch { return [] }
  }

  static async saveSubagentToKV(projectPath: string, subagent: { name: string; description: string; sourcePath: string; tools?: string; enabled: boolean }): Promise<void> {
    try {
      const agent = await getAgentFS(projectPath)
      await agent.kv.set(`subagent:${subagent.name}`, subagent)
    } catch { /* best-effort */ }
  }

  static async removeSubagentFromKV(projectPath: string, subagentName: string): Promise<void> {
    try {
      const agent = await getAgentFS(projectPath)
      await agent.kv.delete(`subagent:${subagentName}`)
    } catch { /* best-effort */ }
  }

  static async listSubagentsFromKV(projectPath: string): Promise<Array<{ name: string; description: string; sourcePath: string; tools?: string; enabled: boolean }>> {
    try {
      const agent = await getAgentFS(projectPath)
      const entries = await agent.kv.list('subagent:')
      return entries.map((e) => e.value)
    } catch { return [] }
  }
}
