import { join } from 'node:path'
import type { AgentProvider } from '../shared/agent-chat-types'
import { SkillsService } from './skills-service'

const MARKDOWN_SKILL_ID_BY_PROVIDER: Partial<Record<AgentProvider, string>> = {
  codex: 'conductor-markdown-codex',
  cursor: 'conductor-markdown-cursor',
}

function bundledSkillsRoot(): string {
  return join(__dirname, '..', '..', 'skills')
}

/** Symlink bundled markdown/mermaid skill into workspace agent skill dirs for SDK discovery. */
export async function syncConductorMarkdownSkill(
  provider: AgentProvider,
  workspacePath: string,
): Promise<void> {
  const skillId = MARKDOWN_SKILL_ID_BY_PROVIDER[provider]
  if (!skillId) return
  const skillPath = join(bundledSkillsRoot(), skillId)
  await SkillsService.syncSkillToAgents(skillPath, workspacePath)
}

export function conductorMarkdownSkillId(provider: AgentProvider): string | undefined {
  return MARKDOWN_SKILL_ID_BY_PROVIDER[provider]
}
