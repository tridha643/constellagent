/**
 * Custom collaboration mode for Codex app-server Conductor turns.
 *
 * Codex's built-in Default-mode developer instructions tell the model to
 * "strongly prefer making reasonable assumptions" over asking questions, which
 * suppresses `request_user_input` even though the Conductor surfaces it as a
 * rich blocking-question UI. Passing the experimental
 * `turn/start.collaborationMode` (verified at codex-cli 0.135.0; client opts in
 * via `capabilities.experimentalApi`) with our own `developer_instructions`
 * replaces that template so the model asks at real decision points.
 *
 * Wire shape (codex-rs `CollaborationMode` / `Settings`, snake_case fields):
 * `{ mode: 'default', settings: { model, reasoning_effort, developer_instructions } }`.
 * The mode's settings take precedence over the top-level `model`/`effort` turn
 * params, so they must carry the same values.
 */
import type { ModelReasoningEffort } from '@openai/codex-sdk'

export interface CodexCollaborationModePayload {
  readonly mode: 'default'
  readonly settings: {
    readonly model: string
    readonly reasoning_effort: ModelReasoningEffort
    readonly developer_instructions: string
  }
}

const MODE_FRAME_EXECUTE = `# Collaboration Mode: Default

You are in Default mode: execute the user's request end-to-end, making edits and running commands as needed. Any previous instructions for other modes (e.g. Plan mode) are no longer active. Your active mode changes only when new developer instructions change it; user requests or tool descriptions do not change mode by themselves.`

const MODE_FRAME_PLAN = `# Collaboration Mode: Default (planning turn)

You are helping the user refine intent and produce a plan this turn. Explore and run non-mutating commands freely, but do not edit repo-tracked files or perform mutating actions; follow the planning instructions in the user message. Your active mode changes only when new developer instructions change it.`

const ASK_INSTRUCTIONS_BODY = `## Asking the user with request_user_input

This client renders \`request_user_input\` as a rich, low-friction question UI, so asking is cheap for the user. Use it liberally: call \`request_user_input\` BEFORE proceeding whenever you reach a decision point where the user's answer could change what you build:

- The request is ambiguous in intent, scope, or success criteria.
- Multiple valid approaches, designs, libraries, or UX patterns exist and the codebase does not dictate the choice.
- You are about to do something destructive or hard to reverse (deleting files, rewriting git history, schema or API contract changes).
- A preference matters (naming, visual style, tradeoffs like speed vs. thoroughness) and you would otherwise guess.
- You are about to make a load-bearing assumption that the repo or conversation has not confirmed.

When in doubt about whether to ask: ask. A five-second question beats building the wrong thing.

Rules:

- Do not ask about facts discoverable from the repo or system. Explore first; ask only if still ambiguous afterward.
- Batch related decisions into one call (up to 3 questions) instead of asking serially. Prefer one question when only one decision is pending.
- Provide 2-3 mutually exclusive options per question. Put your recommended option first and suffix its label with "(Recommended)".
- Never write a multiple-choice question as a plain-text assistant message; always use the tool.
- After receiving answers, continue the task immediately without re-confirming.`

export const CODEX_DEFAULT_MODE_ASK_INSTRUCTIONS = `${MODE_FRAME_EXECUTE}\n\n${ASK_INSTRUCTIONS_BODY}`

export const CODEX_PLAN_TURN_ASK_INSTRUCTIONS = `${MODE_FRAME_PLAN}\n\n${ASK_INSTRUCTIONS_BODY}`

export function buildCodexCollaborationMode(
  model: string,
  reasoningEffort: ModelReasoningEffort,
  plan = false,
): CodexCollaborationModePayload {
  return {
    mode: 'default',
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: plan
        ? CODEX_PLAN_TURN_ASK_INSTRUCTIONS
        : CODEX_DEFAULT_MODE_ASK_INSTRUCTIONS,
    },
  }
}

/**
 * Whether a `turn/start` RPC failure looks like the server rejecting the
 * experimental `collaborationMode` param (older/newer codex builds), in which
 * case the turn should be retried once without it rather than failing the turn.
 */
export function isCollaborationModeUnsupportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const message = err.message.toLowerCase()
  return (
    message.includes('collaborationmode')
    || message.includes('collaboration_mode')
    || message.includes('unknown field')
    || message.includes('invalid params')
    || message.includes('experimental')
  )
}
