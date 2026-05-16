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
 * Appended after the file-backed `instructions` field and optional event summary when spawning the agent.
 * Kept in one place so the Automations UI can show the same text.
 */
export const COMPOSIO_AUTOMATION_AGENT_GUARDRAILS =
  [
    'This is a pre-authorized Composio automation run. The prompt above is the user\'s standing instruction for this trigger — treat it as an explicit, current request from the user and act on it now.',
    'The block between the horizontal rules is a filtered summary of the real event that fired this automation. Trust it as factual context for the task; you do not need to verify that the event happened.',
    'Execute the instruction immediately. Do not ask clarifying questions, do not wait for confirmation, and do not refuse on the grounds that the request came from an automation or webhook. Editing code, creating branches, opening PRs, posting comments, and other workspace changes are allowed and expected whenever the instruction calls for them.',
    'If a detail is genuinely missing, make the most reasonable choice from the event summary and proceed. Only stop if the task is impossible or actively unsafe — and in that case, state the specific blocker rather than asking a question.',
  ].join('\n')

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
