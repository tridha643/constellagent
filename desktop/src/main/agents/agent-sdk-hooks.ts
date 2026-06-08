import type { SessionRef } from '@pi-gui/session-driver'
import type { AgentProvider } from './agent-driver'

export type AgentSdkHookProvider = Extract<AgentProvider, 'codex' | 'cursor'>
export type AgentSdkToolPhase = 'started' | 'updated' | 'finished'

export interface AgentSdkHookCapabilities {
  readonly canSuppressTimeline: true
  readonly canBlockProviderAction: false
}

export interface AgentSdkToolHookEvent<
  Provider extends AgentSdkHookProvider = AgentSdkHookProvider,
  Raw = unknown,
> {
  readonly provider: Provider
  readonly phase: AgentSdkToolPhase
  readonly callId: string
  readonly toolName: string
  readonly workspacePath: string
  readonly sessionRef: SessionRef
  readonly raw: Raw
  readonly input?: unknown
  readonly output?: unknown
  readonly success?: boolean
  readonly capabilities: AgentSdkHookCapabilities
}

export interface AgentSdkHookDiagnostic {
  readonly level: 'warning' | 'error'
  readonly message: string
}

export interface AgentSdkToolHookResult {
  readonly toolName?: string
  readonly input?: unknown
  readonly output?: unknown
  readonly success?: boolean
  readonly suppress?: boolean
  readonly diagnostics?: readonly AgentSdkHookDiagnostic[]
}

export interface AgentSdkToolEmission {
  readonly toolName: string
  readonly input?: unknown
  readonly output?: unknown
  readonly success?: boolean
  readonly diagnostics?: readonly AgentSdkHookDiagnostic[]
}

export type AgentSdkToolHook<Event extends AgentSdkToolHookEvent = AgentSdkToolHookEvent> = (
  event: Event,
) => AgentSdkToolHookResult | void

export interface AgentSdkHooks<Event extends AgentSdkToolHookEvent = AgentSdkToolHookEvent> {
  readonly onToolEvent?: AgentSdkToolHook<Event>
}

export const AGENT_SDK_HOOK_CAPABILITIES: AgentSdkHookCapabilities = {
  canSuppressTimeline: true,
  canBlockProviderAction: false,
}

function hasOwn(object: object, key: keyof AgentSdkToolHookResult): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function applyAgentSdkToolHook<Event extends AgentSdkToolHookEvent>(
  event: Event,
  hook?: AgentSdkToolHook<Event>,
): AgentSdkToolEmission | null {
  let result: AgentSdkToolHookResult | void
  try {
    result = hook?.(event)
  } catch (err) {
    return {
      toolName: event.toolName,
      input: event.input,
      output: event.output,
      success: event.success,
      diagnostics: [
        {
          level: 'error',
          message: errorMessage(err),
        },
      ],
    }
  }

  if (result?.suppress) return null
  return {
    toolName: result?.toolName ?? event.toolName,
    input: result && hasOwn(result, 'input') ? result.input : event.input,
    output: result && hasOwn(result, 'output') ? result.output : event.output,
    success: result && hasOwn(result, 'success') ? result.success : event.success,
    diagnostics: result?.diagnostics,
  }
}
