import type { AgentProvider } from '../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../shared/conductor-thinking'

export interface SideChatSeed {
  workspaceId: string
  workspacePath: string
  repoPath: string
  sourceSessionId: string | null
  forkMessageId: string | null
  sourceTitle: string | null
  draftText: string
  provider: AgentProvider
  model: string
  thinkingLevel: ThinkingLevel
  plan: boolean
  createdAt: number
}

export interface SideChatBinding {
  workspaceId: string
  sessionId: string
  sourceSessionId: string | null
  forkMessageId: string | null
}

type SeedListener = (seed: SideChatSeed) => void

const seedsByWorkspace = new Map<string, SideChatSeed>()
const bindingsByWorkspace = new Map<string, SideChatBinding>()
const seedListeners = new Set<SeedListener>()

export function seedSideChatPanel(seed: SideChatSeed): void {
  seedsByWorkspace.set(seed.workspaceId, seed)
  for (const listener of seedListeners) listener(seed)
}

export function latestSideChatSeed(workspaceId: string): SideChatSeed | null {
  return seedsByWorkspace.get(workspaceId) ?? null
}

export function subscribeSideChatSeeds(listener: SeedListener): () => void {
  seedListeners.add(listener)
  return () => seedListeners.delete(listener)
}

export function bindSideChatSession(binding: SideChatBinding): void {
  bindingsByWorkspace.set(binding.workspaceId, binding)
}

export function clearSideChatBinding(workspaceId: string): void {
  bindingsByWorkspace.delete(workspaceId)
}

export function latestSideChatBinding(workspaceId: string): SideChatBinding | null {
  return bindingsByWorkspace.get(workspaceId) ?? null
}
