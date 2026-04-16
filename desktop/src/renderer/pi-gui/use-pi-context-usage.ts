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

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, sessionRef?.workspaceId, sessionRef?.sessionId]);

  return data;
}
