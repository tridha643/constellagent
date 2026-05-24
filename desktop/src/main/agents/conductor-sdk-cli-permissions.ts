import type { LocalAgentOptions, SandboxOptions } from '@cursor/sdk'
import type { ApprovalMode, SandboxMode, ThreadOptions } from '@openai/codex-sdk'

type CodexConductorThreadPermissions = Pick<
  ThreadOptions,
  'sandboxMode' | 'approvalPolicy' | 'networkAccessEnabled'
>

/**
 * Plan toggle ON — full SDK access. Plans are still kept in chat by the
 * Conductor plan prompt; permissions stay unrestricted so Codex can inspect
 * the workspace and use the same tools available in working mode.
 */
export const CODEX_PLAN_THREAD_PERMISSIONS = {
  sandboxMode: 'danger-full-access' satisfies SandboxMode,
  approvalPolicy: 'never' satisfies ApprovalMode,
  networkAccessEnabled: true,
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

/**
 * Cursor plan — keep sandbox off. Local SDK sandboxing is unavailable inside
 * Electron, and Conductor plan turns rely on PLAN_PROMPT_PREFIX (same as Codex)
 * to render markdown in chat instead of writing plan files.
 */
export const CURSOR_PLAN_LOCAL_PERMISSIONS = {
  sandboxOptions: { enabled: false } satisfies SandboxOptions,
}

/** Cursor working — sandbox off for unrestricted agent mode. */
export const CURSOR_WORKING_LOCAL_PERMISSIONS = {
  sandboxOptions: { enabled: false } satisfies SandboxOptions,
}

/** Cursor local executor sandbox for a Conductor turn (see plan vs working profiles above). */
export function cursorConductorLocalPermissions(_plan: boolean): Pick<LocalAgentOptions, 'sandboxOptions'> {
  // Plan and working both disable sandbox — Electron cannot host the local sandbox.
  return CURSOR_WORKING_LOCAL_PERMISSIONS
}
