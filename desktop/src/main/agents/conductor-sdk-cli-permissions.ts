import type { LocalAgentOptions, SandboxOptions } from '@cursor/sdk'
import type { ApprovalMode, SandboxMode, ThreadOptions } from '@openai/codex-sdk'

type CodexConductorThreadPermissions = Pick<
  ThreadOptions,
  'sandboxMode' | 'approvalPolicy' | 'networkAccessEnabled'
>

/**
 * Plan toggle ON — read-only. Plans are rendered in Conductor chat and no files
 * should be written for plan-mode turns.
 */
export const CODEX_PLAN_THREAD_PERMISSIONS = {
  sandboxMode: 'read-only' satisfies SandboxMode,
  networkAccessEnabled: true,
  approvalPolicy: 'never' satisfies ApprovalMode,
} satisfies CodexConductorThreadPermissions

/** Plan toggle OFF — fully unrestricted agent mode. */
export const CODEX_WORKING_THREAD_PERMISSIONS = {
  sandboxMode: 'danger-full-access' satisfies SandboxMode,
  approvalPolicy: 'never' satisfies ApprovalMode,
  networkAccessEnabled: true,
} satisfies CodexConductorThreadPermissions

/** Codex CLI sandbox + approval for a Conductor turn (see plan vs working profiles above). */
export function codexConductorThreadPermissions(plan: boolean): CodexConductorThreadPermissions {
  return plan ? CODEX_PLAN_THREAD_PERMISSIONS : CODEX_WORKING_THREAD_PERMISSIONS
}

/** Cursor plan — enable local sandbox so plan-mode turns cannot write workspace files. */
export const CURSOR_PLAN_LOCAL_PERMISSIONS = {
  sandboxOptions: { enabled: true } satisfies SandboxOptions,
}

/** Cursor working — sandbox off for unrestricted approvalMode. */
export const CURSOR_WORKING_LOCAL_PERMISSIONS = {
  sandboxOptions: { enabled: false } satisfies SandboxOptions,
}

/** Cursor local executor sandbox for a Conductor turn (see plan vs working profiles above). */
export function cursorConductorLocalPermissions(plan: boolean): Pick<LocalAgentOptions, 'sandboxOptions'> {
  return plan ? CURSOR_PLAN_LOCAL_PERMISSIONS : CURSOR_WORKING_LOCAL_PERMISSIONS
}
