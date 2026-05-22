import type { InteractionUpdate } from '@cursor/sdk'
import {
  isSubagentTool,
  subagentStatusHint,
  toolCallHarnessName,
} from '../../shared/conductor-subagent-utils'

export interface SubagentInteractionEffect {
  readonly callId: string
  readonly text?: string
  /** When true, the driver should remember this call as the active subagent for unattributed deltas. */
  readonly trackCall?: boolean
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/**
 * Maps Cursor SDK `onDelta` / stream interaction updates into Conductor subagent
 * progress (`toolUpdated`) and active-call tracking.
 */
export function subagentInteractionEffect(
  update: InteractionUpdate,
  activeSubagentCallId?: string,
): SubagentInteractionEffect | null {
  switch (update.type) {
    case 'tool-call-started': {
      const name = toolCallHarnessName(update.toolCall)
      if (!name || !isSubagentTool(name)) return null
      const hint = subagentStatusHint(
        typeof update.toolCall === 'object' && update.toolCall !== null && 'args' in update.toolCall
          ? (update.toolCall as { args?: unknown }).args
          : undefined,
      )
      return { callId: update.callId, text: hint, trackCall: true }
    }
    case 'partial-tool-call': {
      const name = toolCallHarnessName(update.toolCall)
      if (!name || !isSubagentTool(name)) return null
      const hint = subagentStatusHint(
        typeof update.toolCall === 'object' && update.toolCall !== null && 'args' in update.toolCall
          ? (update.toolCall as { args?: unknown }).args
          : undefined,
      )
      return { callId: update.callId, text: hint ?? 'Working…', trackCall: true }
    }
    case 'summary': {
      if (!activeSubagentCallId) return null
      const summary = update.summary?.trim()
      if (!summary) return null
      return { callId: activeSubagentCallId, text: firstLine(summary) }
    }
    case 'thinking-delta': {
      if (!activeSubagentCallId) return null
      const text = update.text?.trim()
      if (!text) return null
      return { callId: activeSubagentCallId, text: firstLine(text) }
    }
    default:
      return null
  }
}

/** Progress text from an SDK `task` milestone message for the active subagent row. */
export function subagentTaskMessageText(
  text: string | undefined,
  activeSubagentCallId: string | undefined,
): SubagentInteractionEffect | null {
  if (!activeSubagentCallId) return null
  const trimmed = text?.trim()
  if (!trimmed) return null
  return { callId: activeSubagentCallId, text: firstLine(trimmed) }
}
