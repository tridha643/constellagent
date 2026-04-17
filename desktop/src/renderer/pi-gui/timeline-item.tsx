import type { SessionTranscriptMessage } from "@pi-gui/pi-sdk-driver";
import type { TimelineActivity, TimelineToolCall, TimelineSummary, TranscriptMessage } from "@shared/pi/timeline-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { MessageMarkdown } from "./message-markdown";
import { countDiffFiles, InlineDiff, extractDiffFromOutput, syntheticUnifiedDiffFromWriteToolInput } from "./diff-inline";
import { ChevronRightIcon, CopyIcon, FileIcon } from "./icons";

/** Matches `makeActivityItem("Working…")` in main-process timeline (`pi-timeline.ts`). */
const PI_GUI_WORKING_ACTIVITY_LABEL = "Working…";

function isPiGuiWorkingActivity(item: TimelineActivity): boolean {
  return item.label === PI_GUI_WORKING_ACTIVITY_LABEL;
}

/** Plain text to copy — assistant / summary messages only (not user prompts). */
function aiMessageCopyText(item: SessionTranscriptMessage): string {
  return item.text?.trim() ?? "";
}

function TimelineMessageCopyButton({ text, messageId }: { readonly text: string; readonly messageId: string }) {
  const [copied, setCopied] = useState(false);
  const resetCopiedRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        if (resetCopiedRef.current !== undefined) {
          clearTimeout(resetCopiedRef.current);
        }
        setCopied(true);
        resetCopiedRef.current = setTimeout(() => {
          setCopied(false);
          resetCopiedRef.current = undefined;
        }, 1400);
      })
      .catch(() => {
        /* permission or unsupported — no success flash */
      });
  }, [text]);

  useEffect(() => {
    return () => {
      if (resetCopiedRef.current !== undefined) {
        clearTimeout(resetCopiedRef.current);
      }
    };
  }, []);

  return (
    <button
      type="button"
      className={`timeline-item__copy${copied ? " timeline-item__copy--copied" : ""}`}
      aria-label={copied ? "Copied to clipboard" : "Copy message"}
      data-testid={`copy-message-${messageId}`}
      onClick={handleCopy}
    >
      <CopyIcon />
    </button>
  );
}

export function TimelineItem({
  item,
  expandedToolCallIds,
  onToggleToolCall,
  assistantStreamMessageId,
  sessionRunning = false,
}: {
  readonly item: TranscriptMessage;
  readonly expandedToolCallIds?: ReadonlySet<string>;
  readonly onToggleToolCall?: (callId: string) => void;
  /** When set, this assistant message is still receiving tokens (Streamdown streaming mode). */
  readonly assistantStreamMessageId?: string | null;
  /** In-flight tool rows are shown only in the live “Tool activity” strip under the thread. */
  readonly sessionRunning?: boolean;
}) {
  switch (item.kind) {
    case "message":
      return <TimelineMessage item={item} assistantStreamMessageId={assistantStreamMessageId} />;
    case "activity":
      return <TimelineActivityItem item={item} />;
    case "tool":
      if (sessionRunning && item.status === "running") {
        return null;
      }
      return (
        <TimelineToolCallItem
          item={item}
          expanded={expandedToolCallIds?.has(item.callId) ?? false}
          onToggle={onToggleToolCall}
        />
      );
    case "summary":
      return <TimelineSummaryItem item={item} />;
    default:
      return null;
  }
}

function TimelineMessage({
  item,
  assistantStreamMessageId,
}: {
  readonly item: SessionTranscriptMessage;
  readonly assistantStreamMessageId?: string | null;
}) {
  const copyText = item.role === "user" ? "" : aiMessageCopyText(item);
  const copyControl = copyText ? <TimelineMessageCopyButton text={copyText} messageId={item.id} /> : null;
  const streamThisAssistant =
    item.role === "assistant" && assistantStreamMessageId !== undefined && assistantStreamMessageId === item.id;

  if (item.role === "user") {
    return (
      <article className="timeline-item timeline-item--user">
        <div className="timeline-item__bubble">
          {item.attachments?.length ? (
            <div className="timeline-item__attachments">
              {item.attachments.map((attachment, index) =>
                attachment.kind === "image" ? (
                  <img
                    alt={attachment.name ?? `Attachment ${index + 1}`}
                    className="timeline-item__attachment timeline-item__attachment--image"
                    key={`${item.id}:${index}`}
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  />
                ) : (
                  <div
                    className="timeline-item__attachment timeline-item__attachment--file"
                    key={`${item.id}:${index}`}
                    title={attachment.fsPath}
                  >
                    <span className="timeline-item__attachment-icon" aria-hidden="true">
                      <FileIcon />
                    </span>
                    <span className="timeline-item__attachment-name">{attachment.name}</span>
                  </div>
                ),
              )}
            </div>
          ) : null}
          <MessageMarkdown text={item.text} />
        </div>
      </article>
    );
  }

  if (item.role === "branchSummary" || item.role === "compactionSummary") {
    return (
      <article className="timeline-item timeline-item--summary-card">
        <div className="timeline-item__summary-head">
          <div className="timeline-item__summary-eyebrow">
            {item.role === "branchSummary" ? "Branch summary" : "Compaction summary"}
          </div>
          {copyControl}
        </div>
        <MessageMarkdown text={item.text} preferStreamdown />
      </article>
    );
  }

  return (
    <article className="timeline-item timeline-item--assistant">
      {copyControl ? <div className="timeline-item__message-toolbar timeline-item__message-toolbar--assistant">{copyControl}</div> : null}
      <MessageMarkdown text={item.text} preferStreamdown isStreaming={streamThisAssistant} />
    </article>
  );
}

function TimelineActivityItem({ item }: { readonly item: TimelineActivity }) {
  if (isPiGuiWorkingActivity(item)) {
    return (
      <div className="timeline-activity timeline-activity--working" data-testid="pi-working-activity">
        <ThinkingIndicator className="min-w-0 flex-1 px-0 py-1" data-testid="pi-thinking-indicator" />
        {item.detail ? <span className="timeline-activity__detail">{item.detail}</span> : null}
        {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
      </div>
    );
  }

  return (
    <div className={`timeline-activity timeline-activity--${item.tone ?? "neutral"}`}>
      <span className="timeline-activity__label">{item.label}</span>
      {item.detail ? <span className="timeline-activity__detail">{item.detail}</span> : null}
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}

function TimelineToolCallItem({
  item,
  expanded,
  onToggle,
}: {
  readonly item: TimelineToolCall;
  readonly expanded: boolean;
  readonly onToggle?: (callId: string) => void;
}) {
  const hasContent = item.input !== undefined || item.output !== undefined;
  const diffText = isWriteTool(item.toolName)
    ? extractDiffFromOutput(item.output) ?? syntheticUnifiedDiffFromWriteToolInput(item.input)
    : undefined;
  const diffStats = diffText ? countDiffStats(diffText) : undefined;
  const compactLabel = buildCompactLabel(item, diffStats);

  const handleCopy = () => {
    const text = diffText ?? formatToolContent(item.input, item.output);
    void navigator.clipboard.writeText(text);
  };

  return (
    <article className={`timeline-tool timeline-tool--${item.status}`}>
      <button
        className="timeline-tool__header"
        type="button"
        aria-expanded={expanded}
        disabled={!hasContent}
        onClick={() => onToggle?.(item.callId)}
      >
        {hasContent ? (
          <span className={`timeline-tool__chevron ${expanded ? "timeline-tool__chevron--expanded" : ""}`}>
            <ChevronRightIcon />
          </span>
        ) : null}
        <span className="timeline-tool__label">{compactLabel}</span>
        {diffStats ? (
          <span className="timeline-tool__diff-stats">
            <span className="timeline-tool__stat-add">+{diffStats.added}</span>
            {" "}
            <span className="timeline-tool__stat-del">-{diffStats.removed}</span>
          </span>
        ) : null}
        <span className="timeline-tool__meta-inline">{`${item.toolName} \u00b7 ${statusLabel(item.status)}`}</span>
      </button>
      {expanded && hasContent ? (
        <div className="timeline-tool__body">
          {diffText ? (
            <>
              {countDiffFiles(diffText) <= 1 ? (
                <div className="timeline-tool__diff-header">
                  <span className="timeline-tool__diff-filename">
                    {extractFilename(item.input)}
                    {diffStats ? (
                      <span className="timeline-tool__diff-stats">
                        {" "}
                        <span className="timeline-tool__stat-add">+{diffStats.added}</span>
                        {" "}
                        <span className="timeline-tool__stat-del">-{diffStats.removed}</span>
                      </span>
                    ) : null}
                  </span>
                  <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                    <CopyIcon />
                  </button>
                </div>
              ) : (
                <div className="timeline-tool__diff-header timeline-tool__diff-header--multi">
                  <span className="timeline-tool__diff-filename timeline-tool__diff-filename--muted">Patch</span>
                  <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                    <CopyIcon />
                  </button>
                </div>
              )}
              <InlineDiff diff={diffText} />
            </>
          ) : (
            <>
              <div className="timeline-tool__body-actions">
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                  <CopyIcon />
                </button>
              </div>
              <pre className="timeline-tool__pre">{formatToolContent(item.input, item.output)}</pre>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function isWriteTool(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}

function buildCompactLabel(item: TimelineToolCall, diffStats: { added: number; removed: number } | undefined): string {
  if (isWriteTool(item.toolName)) {
    const filename = extractFilename(item.input);
    if (filename) {
      return `Edited ${shortenPath(filename)}`;
    }
  }
  return item.label;
}

function extractFilename(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const path = record.file_path ?? record.filePath ?? record.path ?? record.filename;
    if (typeof path === "string") {
      return path;
    }
  }
  return "";
}

function shortenPath(filePath: string): string {
  // Show last 2-3 path segments for readability
  const parts = filePath.split("/");
  if (parts.length <= 3) {
    return filePath;
  }
  return parts.slice(-3).join("/");
}

function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function formatToolContent(input: unknown, output: unknown): string {
  const parts: string[] = [];
  if (input !== undefined) {
    parts.push(typeof input === "string" ? input : JSON.stringify(input, null, 2));
  }
  if (output !== undefined) {
    parts.push(typeof output === "string" ? output : JSON.stringify(output, null, 2));
  }
  return parts.join("\n\n");
}

function statusLabel(status: "running" | "success" | "error") {
  if (status === "running") return "running";
  if (status === "success") return "done";
  return "failed";
}

function TimelineSummaryItem({ item }: { readonly item: TimelineSummary }) {
  if (item.presentation === "divider") {
    return (
      <div className="timeline-summary">
        <span>{item.label}</span>
        {item.metadata ? <span className="timeline-summary__meta">{item.metadata}</span> : null}
      </div>
    );
  }

  return (
    <div className="timeline-activity timeline-activity--summary">
      <span className="timeline-activity__label">{item.label}</span>
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}
