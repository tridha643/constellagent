import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "../shared/pi/pi-desktop-state";
import {
  formatElapsedDuration,
  makeActivityItem,
  makeSummaryItem,
  makeToolItem,
  makeTranscriptMessage,
  makeTranscriptMessageWithAttachments,
} from "./pi-app-store-utils";
import {
  buildSubagentMetadata,
  isSubagentTool,
  mergeSubagentResultMetadata,
  subagentStatusHint,
  subagentToolLabel,
} from "../shared/conductor-subagent-utils";
import { safeJsonStringify, toJsonSafe } from "../shared/json-safe";
import { isSkillLoadToolName, skillDisplayFromToolInput } from "../shared/skill-tool-utils";
import { RENDER_JSON_CANVAS_TOOL_NAME } from "../shared/json-canvas-schema";
import {
  extractConductorGeneratedImages,
  isConductorGeneratedImageToolName,
} from "../shared/conductor-generated-images";

export interface RunMetrics {
  readonly startedAt: string;
  toolCount: number;
  searchCount: number;
  fileCount: number;
}

export interface TimelineRuntimeState {
  readonly runMetricsBySession: Map<string, RunMetrics>;
  readonly runningSinceBySession: Map<string, string>;
  readonly activeAssistantMessageBySession: Map<string, string>;
  readonly activeWorkingActivityBySession: Map<string, string>;
}

export function appendUserMessage(
  transcriptCache: Map<string, TranscriptMessage[]>,
  sessionRef: SessionRef,
  text: string,
  attachments: NonNullable<Extract<TranscriptMessage, { kind: "message" }>["attachments"]> = [],
  conductorPlan = false,
): TranscriptMessage[] {
  const key = sessionKey(sessionRef);
  const transcript = [...(transcriptCache.get(key) ?? [])];
  const base =
    attachments.length > 0
      ? makeTranscriptMessageWithAttachments("user", text, attachments)
      : makeTranscriptMessage("user", text);
  const message =
    conductorPlan && base.kind === "message" ? { ...base, conductorPlan: true } : base;
  transcript.push(message);
  transcriptCache.set(key, transcript);
  return transcript;
}

/** Returns the assistant message id that received the delta (for lightweight IPC). */
export function appendAssistantDelta(
  transcriptCache: Map<string, TranscriptMessage[]>,
  activeAssistantMessageBySession: Map<string, string>,
  sessionRef: SessionRef,
  text: string,
): string | undefined {
  if (text.length === 0) {
    return undefined;
  }
  const key = sessionKey(sessionRef);
  let transcript = transcriptCache.get(key);
  if (!transcript) {
    transcript = [];
    transcriptCache.set(key, transcript);
  }
  const activeId = activeAssistantMessageBySession.get(key);

  if (activeId) {
    const lastIndex = transcript.length - 1;
    const last = transcript[lastIndex];
    const index = last?.id === activeId ? lastIndex : transcript.findIndex((message) => message.id === activeId);
    const current = index >= 0 ? transcript[index] : undefined;
    if (current?.kind === "message") {
      transcript[index] = {
        ...current,
        text: `${current.text}${text}`,
      };
      return activeId;
    }
  }

  const message = makeTranscriptMessage("assistant", text);
  transcript.push(message);
  activeAssistantMessageBySession.set(key, message.id);
  return message.id;
}

export function clearActiveAssistantMessage(
  activeAssistantMessageBySession: Map<string, string>,
  sessionRef: SessionRef,
): void {
  activeAssistantMessageBySession.delete(sessionKey(sessionRef));
}

export function applyTimelineEvent(
  transcriptCache: Map<string, TranscriptMessage[]>,
  event: SessionDriverEvent,
  state: TimelineRuntimeState,
): void {
  if (event.type === "assistantDelta") {
    return;
  }

  const key = sessionKey(event.sessionRef);
  const transcript = [...(transcriptCache.get(key) ?? [])];
  const currentMetrics = state.runMetricsBySession.get(key);

  switch (event.type) {
    case "sessionOpened":
      // Omit timeline noise: Codex-style UI does not show “Resumed session” lines.
      break;
    case "sessionUpdated":
      if (event.snapshot.status === "running" && event.snapshot.runningRunId && !state.runningSinceBySession.has(key)) {
        state.runningSinceBySession.set(key, event.timestamp);
        state.runMetricsBySession.set(key, {
          startedAt: event.timestamp,
          toolCount: 0,
          searchCount: 0,
          fileCount: 0,
        });        
        const activity = makeActivityItem("Working…");
        state.activeWorkingActivityBySession.set(key, activity.id);
        transcript.push(activity);
      }
      break;
    case "toolStarted": {
      clearActiveAssistantMessage(state.activeAssistantMessageBySession, event.sessionRef);
      const metrics = currentMetrics ?? {
        startedAt: event.timestamp,
        toolCount: 0,
        searchCount: 0,
        fileCount: 0,
      };
      metrics.toolCount += 1;
      if (looksLikeSearch(event.toolName, event.input)) {
        metrics.searchCount += 1;
      }
      if (looksLikeFileExplore(event.toolName, event.input)) {
        metrics.fileCount += 1;
      }
      state.runMetricsBySession.set(key, metrics);
      if (isSubagentTool(event.toolName)) {
        upsertToolRow(
          transcript,
          event.callId,
          event.toolName,
          "running",
          subagentToolLabel(event.input),
          subagentStatusHint(event.input),
          event.input,
          undefined,
          {
            variant: "subagent",
            metadata: buildSubagentMetadata(event.input),
          },
        );
      } else {
        upsertToolRow(transcript, event.callId, event.toolName, "running", toolLabel(event.toolName, event.input), undefined, event.input);
      }
      break;
    }
    case "toolUpdated": {
      const canvasLabel =
        event.output !== undefined && isRecord(event.output) && typeof event.output.title === 'string'
          ? toolLabel(RENDER_JSON_CANVAS_TOOL_NAME, event.output)
          : undefined
      upsertToolRow(
        transcript,
        event.callId,
        undefined,
        "running",
        canvasLabel,
        event.text ?? progressLabel(event.progress),
        event.output,
        event.output,
      )
      break
    }
    case "toolFinished": {
      const existing = transcript.find(
        (item) => item.kind === "tool" && item.callId === event.callId,
      );
      const existingTool = existing?.kind === "tool" ? existing : undefined;
      const generatedImages =
        event.success && existingTool
          ? extractConductorGeneratedImages(event.output, {
              toolName: existingTool.toolName,
              input: existingTool.input,
            })
          : undefined;
      const subagentFinish =
        existingTool && (existingTool.variant === "subagent" || isSubagentTool(existingTool.toolName))
          ? {
              metadata: mergeSubagentResultMetadata(existingTool.metadata, event.output),
            }
          : undefined;
      upsertToolRow(
        transcript,
        event.callId,
        undefined,
        event.success ? "success" : "error",
        generatedImages ? generatedImageLabel(generatedImages.images.length) : undefined,
        generatedImages ? generatedImageDetail(generatedImages) : detailFromOutput(event.output),
        undefined,
        generatedImages ?? event.output,
        subagentFinish,
      );
      break;
    }
    case "runCompleted": {
      const metrics = currentMetrics;
      clearRunState(transcript, key, event.sessionRef, state);
      if (metrics) {
        const label = summaryLabel(metrics);
        if (label) {
          transcript.push(makeSummaryItem(label, { presentation: "inline" }));
        }
        transcript.push(makeSummaryItem(workedForLabel(metrics.startedAt, event.timestamp), { presentation: "divider" }));
      } else {
        transcript.push(makeSummaryItem("Completed", {
          presentation: "divider",
          metadata: relativeDetail(event.timestamp),
        }));
      }
      break;
    }
    case "runFailed": {
      const metrics = currentMetrics;
      clearRunState(transcript, key, event.sessionRef, state);
      transcript.push(
        makeActivityItem(event.error.message, {
          tone: "error",
          metadata: metrics ? workedForLabel(metrics.startedAt, event.timestamp) : undefined,
          detail: event.error.code,
        }),
      );
      break;
    }
    case "sessionClosed":
      clearRunState(transcript, key, event.sessionRef, state);
      transcript.push(makeActivityItem("Stopped", { metadata: relativeDetail(event.timestamp) }));
      break;
    case "hostUiRequest":
      if (event.request.kind === "notify") {
        transcript.push(makeActivityItem(event.request.message, { metadata: relativeDetail(event.timestamp) }));
      }
      break;
    default:
      break;
  }

  transcriptCache.set(key, transcript);
}

function upsertToolRow(
  transcript: TranscriptMessage[],
  callId: string,
  toolName?: string,
  status?: "running" | "success" | "error",
  label?: string,
  detail?: string,
  input?: unknown,
  output?: unknown,
  extras?: Pick<Extract<TranscriptMessage, { kind: "tool" }>, "variant" | "metadata">,
) {
  const index = transcript.findIndex((item) => item.kind === "tool" && item.callId === callId);
  const existing = index >= 0 ? transcript[index] : undefined;
  const existingTool = existing?.kind === "tool" ? existing : undefined;
  const next = makeToolItem(
    callId,
    toolName ?? (existingTool?.toolName ?? "tool"),
    status ?? (existingTool?.status ?? "running"),
    label ?? (existingTool?.label ?? "Working"),
    {
      detail: detail ?? existingTool?.detail,
      metadata: extras?.metadata ?? existingTool?.metadata,
      variant: extras?.variant ?? existingTool?.variant,
      input: input === undefined ? existingTool?.input : toJsonSafe(input),
      output: output === undefined ? existingTool?.output : toJsonSafe(output),
    },
  );

  if (index >= 0) {
    transcript[index] = {
      ...next,
      createdAt: existing?.createdAt ?? next.createdAt,
    };
    return;
  }

  transcript.push(next);
}

function removeWorkingActivity(transcript: TranscriptMessage[], activityId: string | undefined): void {
  if (!activityId) {
    return;
  }
  const index = transcript.findIndex((item) => item.kind === "activity" && item.id === activityId);
  if (index >= 0) {
    transcript.splice(index, 1);
  }
}

function clearRunState(
  transcript: TranscriptMessage[],
  key: string,
  sessionRef: SessionRef,
  state: TimelineRuntimeState,
): void {
  clearActiveAssistantMessage(state.activeAssistantMessageBySession, sessionRef);
  removeWorkingActivity(transcript, state.activeWorkingActivityBySession.get(key));
  state.activeWorkingActivityBySession.delete(key);
  state.runningSinceBySession.delete(key);
  state.runMetricsBySession.delete(key);
}

function toolLabel(toolName: string, input: unknown): string {
  const normalized = toolName.toLowerCase()
  if (isSkillLoadToolName(normalized)) {
    const { label } = skillDisplayFromToolInput(input)
    return `Loaded ${label} skill`
  }
  if (isConductorGeneratedImageToolName(toolName)) {
    const detail = inputLabel(input)
    return detail ? `Generating image: ${detail}` : 'Generating image'
  }
  if (normalized === 'render_json_canvas' || normalized.endsWith('.render_json_canvas')) {
    if (isRecord(input) && typeof input.title === 'string' && input.title.trim()) {
      return `Canvas: ${input.title.trim()}`
    }
    return 'Rendered canvas'
  }
  const detail = inputLabel(input);
  if (looksLikeSearch(toolName, input)) {
    return detail ? `Searched ${detail}` : `Searched with ${toolName}`;
  }
  if (looksLikeFileExplore(toolName, input)) {
    if (toolName.toLowerCase() === "read") {
      return detail ? `Read ${detail}` : "Read a file";
    }
    return detail ? `Explored ${detail}` : `Explored files with ${toolName}`;
  }
  return detail ? `Ran ${toolName}: ${detail}` : `Ran ${toolName}`;
}

function progressLabel(progress: number | undefined): string | undefined {
  if (progress === undefined) {
    return undefined;
  }
  if (progress <= 1) {
    return `${Math.round(progress * 100)}%`;
  }
  return String(progress);
}

function detailFromOutput(output: unknown): string | undefined {
  if (isRecord(output) && Array.isArray(output.content)) {
    const text = output.content
      .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join(" ")
      .trim();
    if (text) {
      return truncate(text);
    }
  }
  if (typeof output === "string") {
    return truncate(output);
  }
  if (output === undefined || output === null) {
    return undefined;
  }
  return truncate(safeJsonStringify(output));
}

function generatedImageLabel(count: number): string {
  return count === 1 ? 'Generated image' : `Generated ${count} images`
}

function generatedImageDetail(output: ReturnType<typeof extractConductorGeneratedImages>): string | undefined {
  const first = output?.images[0]
  return first?.prompt ?? first?.name ?? first?.filePath
}

function looksLikeSearch(toolName: string, input: unknown): boolean {
  if (toolName.toLowerCase().includes("search")) {
    return true;
  }
  return typeof input === "string" && /https?:\/\/|site:|query|search/i.test(input);
}

function looksLikeFileExplore(toolName: string, input: unknown): boolean {
  if (/(read|glob|ls|list|open)/i.test(toolName)) {
    return true;
  }
  return typeof input === "string" && /\/|\.md|\.ts|file/i.test(input);
}

function summaryLabel(metrics: RunMetrics): string | undefined {
  const parts: string[] = [];
  if (metrics.fileCount > 0) {
    parts.push(`Explored ${metrics.fileCount} file${metrics.fileCount === 1 ? "" : "s"}`);
  }
  if (metrics.searchCount > 0) {
    parts.push(`${metrics.searchCount} search${metrics.searchCount === 1 ? "" : "es"}`);
  }
  if (parts.length === 0 && metrics.toolCount > 0) {
    parts.push(`Used ${metrics.toolCount} tool${metrics.toolCount === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function workedForLabel(startedAt: string, endedAt: string): string {
  return `Worked for ${formatElapsedDuration(startedAt, endedAt)}`;
}

function relativeDetail(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function truncate(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function inputLabel(input: unknown): string | undefined {
  if (typeof input === "string") {
    return truncate(input, 80);
  }
  if (!isRecord(input)) {
    return undefined;
  }

  const candidates = ["path", "filePath", "query", "q", "url", "command", "text", "title", "description", "prompt"];
  for (const key of candidates) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return truncate(value, 80);
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
