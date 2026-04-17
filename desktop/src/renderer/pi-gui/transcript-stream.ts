import type { TranscriptMessage } from "@shared/pi/timeline-types";

/** Live assistant text for the composer “stream” pane while the session is running. */
export function getLiveAssistantStreamPreview(
  transcript: readonly TranscriptMessage[],
  sessionRunning: boolean,
): string {
  if (!sessionRunning) {
    return "";
  }
  const last = transcript[transcript.length - 1];
  if (last?.kind === "message" && last.role === "user") {
    return "";
  }
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const m = transcript[i];
    if (m.kind === "message" && m.role === "assistant") {
      return m.text?.trim() ? m.text : "";
    }
  }
  return "";
}

/** Message id to treat as actively streaming in the timeline (Streamdown animation). */
export function getAssistantStreamMessageId(
  transcript: readonly TranscriptMessage[],
  sessionRunning: boolean,
): string | null {
  if (!sessionRunning) {
    return null;
  }
  const last = transcript[transcript.length - 1];
  if (last?.kind === "message" && last.role === "user") {
    return null;
  }
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const m = transcript[i];
    if (m.kind === "message" && m.role === "assistant") {
      return m.id;
    }
  }
  return null;
}
