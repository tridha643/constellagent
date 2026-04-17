import type { ReactNode } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer/MarkdownRenderer";
import { useExitAnimation } from "@/hooks/useExitAnimation";

/**
 * Composer strip: live assistant markdown only (tool activity lives in the timeline).
 */
export function PiThinkingStrip({
  sessionRunning,
  streamingPreviewText = "",
}: {
  readonly sessionRunning: boolean;
  readonly streamingPreviewText?: string;
}): ReactNode {
  const { shouldRender, animating } = useExitAnimation(sessionRunning, 180);
  if (!shouldRender) {
    return null;
  }

  const streamHasText = streamingPreviewText.trim().length > 0;
  const exiting = animating === "exit";

  return (
    <div
      className={`composer__thinking-strip composer__thinking-strip--stream-only${exiting ? " composer__thinking-strip--exiting" : ""}`}
      data-testid="pi-thinking-strip"
    >
      <div
        className={`composer__thinking-stream${streamHasText ? "" : " composer__thinking-stream--empty"}`}
        data-testid="pi-composer-stream-pane"
      >
        {streamHasText ? (
          <MarkdownRenderer isStreaming className="composer__thinking-streamdown">
            {streamingPreviewText}
          </MarkdownRenderer>
        ) : (
          <p className="composer__thinking-stream-placeholder">Waiting for response…</p>
        )}
      </div>
    </div>
  );
}
