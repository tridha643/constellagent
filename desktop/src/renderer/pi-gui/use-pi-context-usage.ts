import { useEffect, useState } from "react";
import type { PiContextUsageSnapshot, SessionRef } from "@pi-gui/session-driver";
import type { ContextWindowData } from "@shared/context-window-types";

const POLL_MS = 4_000;

function snapshotToContextData(snapshot: PiContextUsageSnapshot | null): ContextWindowData | null {
  if (!snapshot) return null;
  return {
    usedTokens: snapshot.usedTokens,
    contextWindowSize: snapshot.contextWindowSize,
    percentage: snapshot.percentage,
    model: snapshot.model,
    sessionId: snapshot.sessionId,
    lastUpdated: Date.now(),
  };
}

export function usePiContextUsage(sessionRef: SessionRef | undefined, enabled: boolean): ContextWindowData | null {
  const [data, setData] = useState<ContextWindowData | null>(null);

  useEffect(() => {
    if (!enabled || !sessionRef?.workspaceId?.trim() || !sessionRef?.sessionId?.trim()) {
      setData(null);
      return undefined;
    }

    const ref = {
      workspaceId: sessionRef.workspaceId.trim(),
      sessionId: sessionRef.sessionId.trim(),
    };

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = () => {
      void window.api.pi
        .getContextUsageSnapshot(ref)
        .then((s) => {
          if (!cancelled) setData(snapshotToContextData(s));
        })
        .catch(() => {
          if (!cancelled) setData(null);
        });
    };

    const stopTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Pause the 4 s IPC poll while the window is hidden — the user can't see
    // the context ring and the underlying snapshot is in-memory, so resuming
    // with an immediate fetch on visibility is sufficient.
    const startTimer = () => {
      stopTimer();
      timer = setInterval(poll, POLL_MS);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopTimer();
        return;
      }
      poll();
      startTimer();
    };

    if (!document.hidden) {
      poll();
      startTimer();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, sessionRef?.workspaceId, sessionRef?.sessionId]);

  return data;
}
