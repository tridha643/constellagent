import { readdir, readFile } from 'fs/promises'
import { join, basename } from 'path'
import type { AgentProvider } from '../shared/agent-chat-types'
import {
  inferHarnessFromSkillPath,
  resolveHarnessSkillScanDirs,
  skillPathIsNativeForProvider,
  type HarnessSkillScanDir,
  type HarnessSkillTag,
} from '../shared/harness-skill-dirs'
import { isConductorHostSlashName } from '../shared/conductor-composer-commands'
import { getAgentFS } from './agentfs-service'
import { GitService } from './git-service'

export interface SkillInfo {
  name: string
  description: string
}

export interface HarnessSkillInfo {
  name: string
  description: string
  sourcePath: string
  harness?: HarnessSkillTag
}

export interface SubagentInfo {
  name: string
  description: string
  tools?: string
}

export interface SkillSlashInvocation {
  readonly name: string
  readonly args: string
}

export interface ExpandSkillInvocationResult {
  readonly text: string
  readonly isSkillInvocation: boolean
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

function isSingleLineSlashCommand(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('/') && !/\n/.test(trimmed) && /^\/[^\s]+(?:\s+\S+)*$/.test(trimmed)
}

export class SkillsService {
  static async discoverAllHarnessSkills(workspacePath: string): Promise<HarnessSkillInfo[]> {
    const filesystemSkills = await SkillsService.discoverSkillsFromScanDirs(
      resolveHarnessSkillScanDirs(workspacePath),
    )
    const byName = new Map(filesystemSkills.map((skill) => [skill.name, skill]))

    const projectPath = await SkillsService.resolveProjectPath(workspacePath)
    if (projectPath) {
      const catalogSkills = await SkillsService.listSkillsFromKV(projectPath)
      for (const skill of catalogSkills) {
        if (!skill.enabled) continue
        if (byName.has(skill.name)) continue
        const scanned = await SkillsService.scanSkillDir(skill.sourcePath)
        byName.set(skill.name, {
          name: skill.name,
          description: scanned?.description ?? skill.description,
          sourcePath: skill.sourcePath,
          harness: 'catalog',
        })
      }
    }

    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  static async discoverSkillsFromScanDirs(
    scanDirs: readonly HarnessSkillScanDir[],
  ): Promise<HarnessSkillInfo[]> {
    const byName = new Map<string, HarnessSkillInfo>()

    for (const scanDir of scanDirs) {
      let entries: string[] = []
      try {
        entries = await readdir(scanDir.path)
      } catch {
        continue
      }
      for (const entry of entries) {
        const sourcePath = join(scanDir.path, entry)
        const info = await SkillsService.scanSkillDir(sourcePath)
        if (!info) continue
        byName.set(info.name, {
          name: info.name,
          description: info.description,
          sourcePath,
          harness: inferHarnessFromSkillPath(sourcePath),
        })
      }
    }

    return [...byName.values()]
  }

  /** @deprecated Provider arg ignored — scans all harness dirs. Kept for IPC compatibility. */
  static async discoverHarnessSkills(
    _provider: AgentProvider,
    workspacePath: string,
  ): Promise<HarnessSkillInfo[]> {
    return SkillsService.discoverAllHarnessSkills(workspacePath)
  }

  static parseSkillSlash(text: string): SkillSlashInvocation | null {
    if (!isSingleLineSlashCommand(text)) return null
    const trimmed = text.trim()
    const body = trimmed.slice(1)
    const spaceIdx = body.indexOf(' ')
    const name = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase()
    if (!name || isConductorHostSlashName(name)) return null
    const args = spaceIdx === -1 ? '' : body.slice(spaceIdx + 1).trim()
    return { name, args }
  }

  static isSkillSlash(text: string): boolean {
    return SkillsService.parseSkillSlash(text) !== null
  }

  static async expandSkillInvocation(
    text: string,
    provider: AgentProvider,
    workspacePath: string,
  ): Promise<ExpandSkillInvocationResult> {
    const invocation = SkillsService.parseSkillSlash(text)
    if (!invocation) {
      return { text, isSkillInvocation: false }
    }

    const skills = await SkillsService.discoverAllHarnessSkills(workspacePath)
    const skill = skills.find((entry) => entry.name.toLowerCase() === invocation.name)
    if (!skill) {
      return { text, isSkillInvocation: false }
    }

    if (provider === 'pi') {
      const command = invocation.args
        ? `/skill:${skill.name} ${invocation.args}`
        : `/skill:${skill.name}`
      return { text: command, isSkillInvocation: true }
    }

    if (
      (provider === 'codex' || provider === 'cursor') &&
      skillPathIsNativeForProvider(skill.sourcePath, provider)
    ) {
      const command = invocation.args ? `/${skill.name} ${invocation.args}` : `/${skill.name}`
      return { text: command, isSkillInvocation: true }
    }

    const body = await SkillsService.readSkillBody(skill.sourcePath)
    if (!body) {
      const command = invocation.args ? `/${skill.name} ${invocation.args}` : `/${skill.name}`
      return { text: command, isSkillInvocation: true }
    }

    const parts = [`Follow this skill (${skill.name}):`, body]
    if (invocation.args) {
      parts.push(`User request: ${invocation.args}`)
    }
    return { text: parts.join('\n\n'), isSkillInvocation: true }
  }

  static async readSkillBody(skillPath: string): Promise<string | null> {
    const skillMdPath = join(skillPath, 'SKILL.md')
    try {
      const content = await readFile(skillMdPath, 'utf-8')
      const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
      return body || null
    } catch {
      return null
    }
  }

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

  private static async resolveProjectPath(workspacePath: string): Promise<string | null> {
    if (!workspacePath) return null
    try {
      if (!(await GitService.isGitRepo(workspacePath))) return null
      return await GitService.getTopLevel(workspacePath)
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
