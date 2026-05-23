import type { LocalAgentOptions, SandboxOptions } from '@cursor/sdk'
import type { ApprovalMode, SandboxMode, ThreadOptions } from '@openai/codex-sdk'

type CodexConductorThreadPermissions = Pick<
  ThreadOptions,
  'sandboxMode' | 'approvalPolicy' | 'networkAccessEnabled'
>

/**
 * Plan toggle ON — workspace-write + network (Codex SDK maps `networkAccessEnabled` to
 * `sandbox_workspace_write.network_access` only; read-only ignores it and blocks CLIs like nia).
 * Non-plan file edits are blocked by PLAN_PROMPT_PREFIX (only agent plan dirs are writable).
 */
export const CODEX_PLAN_THREAD_PERMISSIONS = {
  sandboxMode: 'workspace-write' satisfies SandboxMode,
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

/** Cursor plan — sandbox off so network CLIs work; file scope enforced via PLAN_PROMPT_PREFIX. */
export const CURSOR_PLAN_LOCAL_PERMISSIONS = {
  sandboxOptions: { enabled: false } satisfies SandboxOptions,
}

/** Cursor working — sandbox off for unrestricted approvalMode. */
export const CURSOR_WORKING_LOCAL_PERMISSIONS = {
  sandboxOptions: { enabled: false } satisfies SandboxOptions,
}

/** Cursor local executor sandbox for a Conductor turn (see plan vs working profiles above). */
export function cursorConductorLocalPermissions(plan: boolean): Pick<LocalAgentOptions, 'sandboxOptions'> {
  return plan ? CURSOR_PLAN_LOCAL_PERMISSIONS : CURSOR_WORKING_LOCAL_PERMISSIONS
}
