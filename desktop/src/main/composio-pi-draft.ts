import type { ComposioPiAutomationDraft } from '../shared/composio-types'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

export function parseComposioPiAutomationDraft(raw: unknown): ComposioPiAutomationDraft {
  if (!isRecord(raw)) throw new Error('Draft must be a JSON object')
  const projectId = typeof raw.projectId === 'string' ? raw.projectId : ''
  const triggerSlug = typeof raw.triggerSlug === 'string' ? raw.triggerSlug : ''
  const connectedAccountId =
    typeof raw.connectedAccountId === 'string' ? raw.connectedAccountId : ''
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : ''
  if (!projectId) throw new Error('draft.projectId required')
  if (!triggerSlug) throw new Error('draft.triggerSlug required')
  if (!connectedAccountId) throw new Error('draft.connectedAccountId required')
  if (!prompt) throw new Error('draft.prompt required')
  const tc = raw.triggerConfig
  const triggerConfig =
    isRecord(tc) ? (tc as Record<string, unknown>) : ({} as Record<string, unknown>)
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    projectId,
    triggerSlug,
    connectedAccountId,
    triggerConfig,
    prompt,
  }
}
