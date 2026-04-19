import type { FileDiffSection } from "./diff-core";
import type { TranscriptMessage, TimelineToolCall } from "@shared/pi/timeline-types";
import {
  extractDiffFromOutput,
  parseDiffIntoSections,
  syntheticUnifiedDiffFromWriteToolInput,
} from "./diff-core";

export interface AggregateWriteToolStats {
  readonly fileCount: number;
  readonly added: number;
  readonly removed: number;
}

export function isWriteToolName(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}

function isToolMessage(m: TranscriptMessage): m is TimelineToolCall {
  return m.kind === "tool";
}

/** Messages after the most recent user prompt, chronological order. */
export function collectTailAfterLastUser(transcript: readonly TranscriptMessage[]): TranscriptMessage[] {
  const tail: TranscriptMessage[] = [];
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const m = transcript[i];
    if (!m) {
      break;
    }
    if (m.kind === "message" && m.role === "user") {
      break;
    }
    tail.push(m);
  }
  tail.reverse();
  return tail;
}

/**
 * Merge write/edit tool diffs from the current turn into one section list (last tool wins per path).
 */
export function aggregateWriteToolFileSections(
  transcript: readonly TranscriptMessage[],
): readonly FileDiffSection[] | null {
  const tail = collectTailAfterLastUser(transcript);
  const pathOrder: string[] = [];
  const byPath = new Map<string, FileDiffSection>();

  for (const m of tail) {
    if (!isToolMessage(m) || m.status !== "success") {
      continue;
    }
    if (!isWriteToolName(m.toolName)) {
      continue;
    }
    const diffText =
      extractDiffFromOutput(m.output) ?? syntheticUnifiedDiffFromWriteToolInput(m.input);
    if (!diffText?.trim()) {
      continue;
    }
    for (const sec of parseDiffIntoSections(diffText)) {
      if (!byPath.has(sec.path)) {
        pathOrder.push(sec.path);
      }
      byPath.set(sec.path, sec);
    }
  }

  if (pathOrder.length === 0) {
    return null;
  }
  return pathOrder.map((p) => byPath.get(p)!);
}

/**
 * After the last user message through the end of `transcript`, sum successful write/edit tool diffs.
 * Returns null if there are no qualifying tools or no parseable diff content.
 */
export function aggregateWriteToolStats(transcript: readonly TranscriptMessage[]): AggregateWriteToolStats | null {
  const sections = aggregateWriteToolFileSections(transcript);
  if (!sections || sections.length === 0) {
    return null;
  }
  let added = 0;
  let removed = 0;
  for (const s of sections) {
    added += s.added;
    removed += s.removed;
  }
  return { fileCount: sections.length, added, removed };
}
