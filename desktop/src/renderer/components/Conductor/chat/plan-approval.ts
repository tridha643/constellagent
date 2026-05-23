import type { TranscriptMessage } from '../../../../shared/pi/pi-desktop-state'

export const APPROVE_PLAN_MESSAGE = 'Approved. Please proceed with implementation.'

export function getLatestPlanApprovalMessageId(
  transcript: readonly TranscriptMessage[],
): string | null {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const item = transcript[i]
    if (item.kind !== 'message') continue
    if (item.role === 'user') return null
    if (item.role === 'assistant' && item.text.trim().length > 0) return item.id
  }
  return null
}
