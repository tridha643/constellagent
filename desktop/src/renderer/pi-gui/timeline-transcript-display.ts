import type { TranscriptMessage } from "@shared/pi/timeline-types";

export function findLastUserMessageIndex(transcript: readonly TranscriptMessage[]): number {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m?.kind === "message" && m.role === "user") {
      return i;
    }
  }
  return -1;
}

/** Last tool call id in the suffix after the most recent user message, if any. */
export function latestToolCallIdAfterLastUser(transcript: readonly TranscriptMessage[]): string | null {
  const u = findLastUserMessageIndex(transcript);
  let last: string | null = null;
  for (let i = u + 1; i < transcript.length; i++) {
    const m = transcript[i];
    if (m?.kind === "tool") {
      last = m.callId;
    }
  }
  return last;
}

/**
 * After the latest user message, show only the most recent tool row (single slot that updates).
 * Earlier turns (tools before that user message) stay fully visible.
 */
export function transcriptWithSingleToolSlotAfterLastUser(
  transcript: readonly TranscriptMessage[],
): TranscriptMessage[] {
  const u = findLastUserMessageIndex(transcript);
  const latest = latestToolCallIdAfterLastUser(transcript);
  if (u < 0 || latest === null) {
    return [...transcript];
  }
  return transcript.filter((item, idx) => {
    if (item.kind !== "tool") {
      return true;
    }
    if (idx <= u) {
      return true;
    }
    return item.callId === latest;
  });
}
