import type { TranscriptMessage, TimelineToolCall } from "@shared/pi/timeline-types";

export function isToolMessage(m: TranscriptMessage): m is Extract<TranscriptMessage, { kind: "tool" }> {
  return m.kind === "tool";
}

/** Prefer agent detail, then metadata, then formatted I/O (may be long). */
export function buildToolDescription(tool: TimelineToolCall): string | undefined {
  const detail = tool.detail?.trim();
  if (detail) {
    return detail;
  }
  const meta = tool.metadata?.trim();
  if (meta) {
    return meta;
  }
  const parts: string[] = [];
  if (tool.input !== undefined) {
    parts.push(
      typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input, null, 2),
    );
  }
  if (tool.output !== undefined) {
    parts.push(
      typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output, null, 2),
    );
  }
  if (parts.length === 0) {
    return undefined;
  }
  const joined = parts.join("\n\n");
  return joined.length > 1600 ? `${joined.slice(0, 1600)}…` : joined;
}

/** The tool call currently executing (only one at a time in the live strip). */
export function getCurrentRunningTool(
  transcript: readonly TranscriptMessage[],
): TimelineToolCall | null {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const m = transcript[i];
    if (isToolMessage(m) && m.status === "running") {
      return m;
    }
  }
  return null;
}
