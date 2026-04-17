import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TranscriptMessage } from "@shared/pi/timeline-types";
import {
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
  ThinkingStep,
} from "@/components/ui/thinking-steps";
import { useExitAnimation } from "@/hooks/useExitAnimation";
import { buildToolDescription, getCurrentRunningTool } from "./pi-tool-activity-utils";

/**
 * Single in-flight tool under the thread (below “Working…” when it’s last).
 * Replaced on each new running tool; hides when nothing is running.
 */
export function PiLiveToolActivity({
  transcript,
  sessionRunning,
  onLayout,
}: {
  readonly transcript: readonly TranscriptMessage[];
  readonly sessionRunning: boolean;
  /** Fire after mount/size change so the timeline can scroll when pinned to bottom. */
  readonly onLayout?: () => void;
}): ReactNode {
  const [open, setOpen] = useState(true);

  const runningTool = useMemo(() => {
    if (!sessionRunning) {
      return null;
    }
    return getCurrentRunningTool(transcript);
  }, [transcript, sessionRunning]);

  const lastToolRef = useRef(runningTool);
  if (runningTool) {
    lastToolRef.current = runningTool;
  }

  const isVisible = !!runningTool;
  const { shouldRender, animating } = useExitAnimation(isVisible, 200);

  useLayoutEffect(() => {
    onLayout?.();
  }, [runningTool?.callId, runningTool?.id, onLayout]);

  if (!shouldRender) {
    return null;
  }

  const displayTool = runningTool ?? lastToolRef.current;
  if (!displayTool) {
    return null;
  }

  const label = displayTool.label?.trim() || displayTool.toolName;
  const description = buildToolDescription(displayTool);
  const exiting = animating === "exit";

  return (
    <div
      className={`timeline-live-tool-activity${exiting ? " timeline-live-tool-activity--exiting" : ""}`}
      data-testid="pi-live-tool-activity"
    >
      <ThinkingSteps
        key={displayTool.callId || displayTool.id}
        open={open}
        onOpenChange={setOpen}
        className="w-full min-w-0 max-w-full border-0 bg-transparent shadow-none"
      >
        <ThinkingStepsHeader className="text-[12px] font-semibold text-muted-foreground">
          Tool activity
        </ThinkingStepsHeader>
        <ThinkingStepsContent className="timeline-live-tool-activity__content">
          <ThinkingStep
            index={0}
            showIcon={false}
            label={label}
            description={description}
            status="active"
            isLast
          />
        </ThinkingStepsContent>
      </ThinkingSteps>
    </div>
  );
}
