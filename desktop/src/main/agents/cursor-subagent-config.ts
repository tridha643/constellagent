import type { AgentDefinition } from '@cursor/sdk'
import { SkillsService } from '../skills-service'

/** Loads enabled project subagents from AgentFS KV into Cursor SDK `AgentOptions.agents`. */
export async function loadCursorSdkAgents(
  projectPath: string,
): Promise<Record<string, AgentDefinition>> {
  const entries = await SkillsService.listSubagentsFromKV(projectPath)
  const agents: Record<string, AgentDefinition> = {}

  for (const entry of entries) {
    if (!entry.enabled) continue
    const def = await SkillsService.readSubagentDefinition(entry.sourcePath)
    if (!def?.prompt.trim()) continue

    agents[entry.name] = {
      description: def.description.trim() || entry.description,
      prompt: def.prompt.trim(),
      ...(def.model && def.model !== 'inherit' ? { model: { id: def.model } } : {}),
    }
  }

  return agents
}
