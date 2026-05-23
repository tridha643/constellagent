import { join } from 'node:path'
import type { AgentProvider } from '../shared/agent-chat-types'
import { SkillsService } from './skills-service'

const SKILL_ID_BY_PROVIDER: Record<AgentProvider, string> = {
  codex: 'conductor-canvas-codex',
  cursor: 'conductor-canvas-cursor',
}

function bundledSkillsRoot(): string {
  return join(__dirname, '..', '..', 'skills')
}

/** Symlink bundled canvas skill into workspace agent skill dirs for SDK discovery. */
export async function syncConductorCanvasSkill(
  provider: AgentProvider,
  workspacePath: string,
): Promise<void> {
  const skillId = SKILL_ID_BY_PROVIDER[provider]
  const skillPath = join(bundledSkillsRoot(), skillId)
  await SkillsService.syncSkillToAgents(skillPath, workspacePath)
}

export function conductorCanvasSkillId(provider: AgentProvider): string {
  return SKILL_ID_BY_PROVIDER[provider]
}
