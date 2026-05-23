import type { LocalAgentOptions, SandboxOptions } from '@cursor/sdk'
import type { ApprovalMode, SandboxMode, ThreadOptions } from '@openai/codex-sdk'

/** Codex CLI sandbox + approval for a Conductor turn (plan = read-only, working = unrestricted). */
export function codexConductorThreadPermissions(
  plan: boolean,
): Pick<ThreadOptions, 'sandboxMode' | 'approvalPolicy'> {
  if (plan) {
    return { sandboxMode: 'read-only' satisfies SandboxMode }
  }
  return {
    sandboxMode: 'danger-full-access' satisfies SandboxMode,
    approvalPolicy: 'never' satisfies ApprovalMode,
  }
}

/**
 * Cursor local executor sandbox for a Conductor turn.
 * Working mode disables sandbox (`insecure_none`) so the SDK keeps approvalMode unrestricted.
 */
export function cursorConductorLocalPermissions(plan: boolean): Pick<LocalAgentOptions, 'sandboxOptions'> {
  if (plan) return {}
  return { sandboxOptions: { enabled: false } satisfies SandboxOptions }
}
