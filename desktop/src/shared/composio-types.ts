/**
 * Composio ↔ Constellagent integration types.
 *
 * Webhook payloads from Composio / toolkit forwarders vary; see composio-payload.ts for normalization.
 */

/** Persisted with app state (constellagent-state.json). */
export interface ComposioWebhookSettings {
  /** When true, the HTTP listener starts (if port available). */
  enabled: boolean
  /** Local TCP port for the webhook server. */
  port: number
  /** URL path (must start with /). Default /webhooks/composio */
  path: string
  /**
   * Optional shared secret. Incoming requests must send the same value via
   * header `x-constellagent-webhook-secret` or query `?secret=`.
   * If empty, secret check is skipped (local dev only — never expose bindAllInterfaces publicly without a secret).
   */
  sharedSecret: string
  /** When false (default), listen on 127.0.0.1 only. When true, listen on 0.0.0.0 (tunnels / LAN). */
  bindAllInterfaces: boolean
  /**
   * Optional public base URL for display/copy only (e.g. https://abc.ngrok-free.app).
   * Callback URL = publicBaseUrl + path (no trailing slash on base).
   */
  publicBaseUrl: string
  /** Legacy optional API key override; new auth flows prefer the Pi extension, COMPOSIO_API_KEY, or CLI login. */
  apiKey: string
}

export const DEFAULT_COMPOSIO_WEBHOOK_SETTINGS: ComposioWebhookSettings = {
  enabled: false,
  port: 37581,
  path: '/webhooks/composio',
  sharedSecret: '',
  bindAllInterfaces: false,
  publicBaseUrl: '',
  apiKey: '',
}

/** Runtime status for the hidden ngrok tunnel launched from Composio settings. */
export interface ComposioNgrokStatus {
  running: boolean
  publicUrl?: string
  localPort?: number
  startedAt?: number
  lastError?: string
}

/** Optional linkage stored on automations (Composio trigger instance lifecycle). */
export interface ComposioAutomationLink {
  triggerInstanceId?: string
  triggerSlug?: string
  connectedAccountId?: string
}

/**
 * JSON contract for Pi / manual “draft” paste: maps to one automation row + Composio trigger params.
 * Pi NL flow: model emits this shape; renderer validates and calls IPC for upsert + save.
 */
export interface ComposioPiAutomationDraft {
  name?: string
  projectId: string
  /** GitHub trigger slug from `composio triggers list github` (case-insensitive upstream). */
  triggerSlug: string
  connectedAccountId: string
  triggerConfig: Record<string, unknown>
  /** User prompt for run-prompt action. */
  prompt: string
}

export type ComposioAutomationAgent =
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'cursor'
  | 'opencode'
  | 'pi-constell'

/** Canonical hook order for UIs and validation. */
export const COMPOSIO_AUTOMATION_AGENTS: readonly ComposioAutomationAgent[] = [
  'claude-code',
  'codex',
  'gemini',
  'cursor',
  'opencode',
  'pi-constell',
]

export const COMPOSIO_AUTOMATION_AGENT_LABELS: Record<ComposioAutomationAgent, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  'pi-constell': 'Pi (Constell)',
}

export function isComposioAutomationAgent(value: unknown): value is ComposioAutomationAgent {
  return typeof value === 'string' && (COMPOSIO_AUTOMATION_AGENTS as readonly string[]).includes(value)
}

/**
 * Appended after the file-backed `instructions` field when spawning the agent.
 * Kept in one place so the Automations UI can show the same text.
 */
export const COMPOSIO_AUTOMATION_AGENT_GUARDRAILS =
  'Implement the task described in the prompt above.\nDo not change code or project files unless the user explicitly asks you to.'

/** Raw file-backed automation entry written by the Composio x Pi extension. */
export interface ComposioAutomationFileEntry {
  id?: string
  name: string
  triggerId: string
  triggerSlug: string
  instructions: string
  enabled?: boolean
  agent?: ComposioAutomationAgent
  workspace?: string
  metadata?: Record<string, unknown>
  updatedAt?: string
  [key: string]: unknown
}

/** Normalized file-backed automation definition for renderer + runtime use. */
export interface ComposioAutomationDefinition {
  id: string
  name: string
  triggerId: string
  triggerSlug: string
  instructions: string
  enabled: boolean
  agent: ComposioAutomationAgent
  workspace: string
  repoPath: string
  filePath: string
  metadata: Record<string, unknown>
  updatedAt?: string
}
