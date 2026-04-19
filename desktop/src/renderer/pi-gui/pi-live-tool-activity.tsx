import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TranscriptMessage } from "@shared/pi/timeline-types";
import { MoonwalkGlyph } from "@/components/ui/moonwalk-glyph";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { useExitAnimation } from "@/hooks/useExitAnimation";
import { buildToolDescription, getCurrentRunningTool } from "./pi-tool-activity-utils";
import { InlineDiffSections } from "./diff-inline";
import { parseDiffIntoSections, type FileDiffSection } from "./diff-core";
import { diffStatusSnapshots, type GitFileStatusRow, type TurnPathChange } from "./git-turn-delta";
import { aggregateWriteToolFileSections } from "./write-tools-aggregate";

interface CachedFooterState {
  readonly sections: readonly FileDiffSection[] | null;
  readonly pills: readonly TurnPathChange[] | null;
}

const latestCompletedFooterByWorktree = new Map<string, CachedFooterState>();

function getCachedFooterState(worktreePath?: string): CachedFooterState | null {
  const wt = worktreePath?.trim();
  return wt ? latestCompletedFooterByWorktree.get(wt) ?? null : null;
}

function pillKindGlyph(kind: TurnPathChange["kind"]): string {
  switch (kind) {
    case "created":
      return "A";
    case "deleted":
      return "D";
    default:
      return "M";
  }
}

/**
 * Single in-flight tool under the thread; on run completion, merged file changes (summary + expandable diffs).
 * Prefers git status snapshot delta vs worktree when `worktreePath` is set; falls back to transcript write-tool diffs.
 */
export function PiLiveToolActivity({
  transcript,
  sessionRunning,
  worktreePath,
  onLayout,
}: {
  readonly transcript: readonly TranscriptMessage[];
  readonly sessionRunning: boolean;
  readonly worktreePath?: string;
  /** Fire after mount/size change so the timeline can scroll when pinned to bottom. */
  readonly onLayout?: () => void;
}): ReactNode {
  const [open, setOpen] = useState(true);
  const [pillLatched, setPillLatched] = useState(false);
  const prevSessionRunningRef = useRef(sessionRunning);
  const initialCachedFooter = getCachedFooterState(worktreePath);

  const [gitTurnSections, setGitTurnSections] = useState<readonly FileDiffSection[] | null>(
    initialCachedFooter?.sections ?? null,
  );
  const [gitTurnPills, setGitTurnPills] = useState<readonly TurnPathChange[] | null>(
    initialCachedFooter?.pills ?? null,
  );
  const [gitTurnPending, setGitTurnPending] = useState(false);

  /** Last `getStatus` while the session was idle; read synchronously when a run starts (async baseline was often still null for fast runs). */
  const latestIdleStatusRef = useRef<GitFileStatusRow[] | null>(null);
  /** Snapshot copied from `latestIdleStatusRef` on idle→running (layout); consumed when the run ends. */
  const runStartSnapshotRef = useRef<readonly GitFileStatusRow[] | null>(null);
  const runningRef = useRef(sessionRunning);
  runningRef.current = sessionRunning;

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

  const transcriptIdle = useMemo(
    () => (sessionRunning ? null : aggregateWriteToolFileSections(transcript)),
    [sessionRunning, transcript],
  );

  const runJustEnded = prevSessionRunningRef.current && !sessionRunning;
  prevSessionRunningRef.current = sessionRunning;

  const prevWorktreeRef = useRef(worktreePath);
  useEffect(() => {
    if (prevWorktreeRef.current === worktreePath) {
      return;
    }
    prevWorktreeRef.current = worktreePath;
    const cached = getCachedFooterState(worktreePath);
    setGitTurnSections(cached?.sections ?? null);
    setGitTurnPills(cached?.pills ?? null);
    setGitTurnPending(false);
    latestIdleStatusRef.current = null;
    runStartSnapshotRef.current = null;
  }, [worktreePath]);

  /** Prime idle snapshot as soon as the worktree is known (reduces "first message before any idle poll" gaps). */
  useEffect(() => {
    const wt = worktreePath?.trim();
    if (!wt) {
      return;
    }
    let cancelled = false;
    void window.api.git
      .getStatus(wt)
      .then((rows) => {
        if (cancelled || runningRef.current) {
          return;
        }
        latestIdleStatusRef.current = rows as GitFileStatusRow[];
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [worktreePath]);

  /** Refresh git snapshot whenever we're idle so `latestIdleStatusRef` is ready before the next send. */
  useEffect(() => {
    const wt = worktreePath?.trim();
    if (!wt || sessionRunning) {
      return;
    }
    let cancelled = false;
    void window.api.git
      .getStatus(wt)
      .then((rows) => {
        if (cancelled || runningRef.current) {
          return;
        }
        latestIdleStatusRef.current = rows as GitFileStatusRow[];
      })
      .catch(() => {
        if (cancelled || runningRef.current) {
          return;
        }
        latestIdleStatusRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [sessionRunning, worktreePath, transcript.length]);

  const prevSessionRunningLayoutRef = useRef(sessionRunning);
  useLayoutEffect(() => {
    const wt = worktreePath?.trim();
    const prev = prevSessionRunningLayoutRef.current;
    prevSessionRunningLayoutRef.current = sessionRunning;

    if (!wt) {
      runStartSnapshotRef.current = null;
      return;
    }

    if (!prev && sessionRunning) {
      const idle = latestIdleStatusRef.current;
      if (idle === null) {
        runStartSnapshotRef.current = null;
      } else if (idle.length === 0) {
        runStartSnapshotRef.current = [];
      } else {
        runStartSnapshotRef.current = idle.map((r) => ({ ...r }));
      }
    }
  }, [sessionRunning, worktreePath]);

  const prevSessionRunningForGitRef = useRef(sessionRunning);
  useEffect(() => {
    const wasRunning = prevSessionRunningForGitRef.current;
    prevSessionRunningForGitRef.current = sessionRunning;

    const wt = worktreePath?.trim();
    if (!wt) {
      setGitTurnSections(null);
      setGitTurnPills(null);
      setGitTurnPending(false);
      return;
    }

    if (!(wasRunning && !sessionRunning)) {
      return;
    }

    const beforeSnapshot = runStartSnapshotRef.current;
    runStartSnapshotRef.current = null;

    // `null` means we never got an idle `getStatus` (e.g. mounted mid-run); fall back to transcript-only.
    if (beforeSnapshot === null) {
      setGitTurnSections(null);
      setGitTurnPills(null);
      setGitTurnPending(false);
      return;
    }

    const before = [...beforeSnapshot];

    setGitTurnPending(true);
    let cancelled = false;

    void (async () => {
      try {
        const after = await window.api.git.getStatus(wt);
        if (cancelled) {
          return;
        }
        const delta = diffStatusSnapshots(before, after as GitFileStatusRow[]);
        if (delta.length === 0) {
          setGitTurnPills(null);
          setGitTurnSections(null);
          latestCompletedFooterByWorktree.delete(wt);
          return;
        }
        setGitTurnPills(delta);
        const sections: FileDiffSection[] = [];
        for (const { path } of delta) {
          const text = await window.api.git.getFileDiff(wt, path);
          if (cancelled) {
            return;
          }
          if (!text?.trim()) {
            continue;
          }
          sections.push(...parseDiffIntoSections(text));
        }
        const nextSections = sections.length ? sections : null;
        setGitTurnSections(nextSections);
        latestCompletedFooterByWorktree.set(wt, {
          pills: delta,
          sections: nextSections,
        });
        if (!cancelled) {
          latestIdleStatusRef.current = after as GitFileStatusRow[];
        }
      } catch {
        if (!cancelled) {
          setGitTurnPills(null);
          setGitTurnSections(null);
        }
      } finally {
        if (!cancelled) {
          setGitTurnPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionRunning, worktreePath]);

  useLayoutEffect(() => {
    if (sessionRunning) {
      setPillLatched(false);
      return;
    }
    // Latch only gates **transcript-derived** footers. Git pills/sections are not latched: on the runJustEnded frame,
    // gitTurnPending is still false (set in useEffect), so latch would clear and git UI would never appear.
    const hasTranscript = (transcriptIdle?.length ?? 0) > 0;
    const hasTranscriptFooter = hasTranscript && !(gitTurnSections?.length ?? 0);

    if (runJustEnded) {
      setPillLatched(hasTranscriptFooter || (gitTurnPending && !!worktreePath?.trim()));
      return;
    }
    setPillLatched((latched) => {
      if (!latched) {
        return false;
      }
      return hasTranscriptFooter || (gitTurnPending && !!worktreePath?.trim());
    });
  }, [sessionRunning, transcript, runJustEnded, gitTurnSections, gitTurnPending, transcriptIdle, worktreePath]);

  /** Git output from the last completed turn — always shown when idle (not gated by pill latch). */
  const idleFooterPills =
    !sessionRunning && gitTurnPills && gitTurnPills.length > 0 ? gitTurnPills : null;

  const idleChangeSections = !sessionRunning
    ? (gitTurnSections?.length ?? 0) > 0
      ? gitTurnSections
      : (pillLatched || runJustEnded) && (transcriptIdle?.length ?? 0) > 0
        ? transcriptIdle
        : null
    : null;

  const isVisible = !!(
    runningTool ||
    (idleChangeSections && idleChangeSections.length > 0) ||
    (idleFooterPills && idleFooterPills.length > 0) ||
    (!sessionRunning && gitTurnPending && !!worktreePath?.trim())
  );
  const { shouldRender, animating } = useExitAnimation(isVisible, 200);

  useLayoutEffect(() => {
    onLayout?.();
  }, [
    runningTool?.callId,
    runningTool?.id,
    idleChangeSections,
    idleFooterPills,
    gitTurnPending,
    onLayout,
  ]);

  if (!shouldRender) {
    return null;
  }

  const exiting = animating === "exit";
  const displayTool = runningTool ?? lastToolRef.current;

  if (runningTool && displayTool) {
    const label = displayTool.label?.trim() || displayTool.toolName;
    const description = buildToolDescription(displayTool);

    return (
      <div
        className={`timeline-live-tool-activity${exiting ? " timeline-live-tool-activity--exiting" : ""}`}
        data-testid="pi-live-tool-activity"
      >
        <div className="timeline-live-tool-activity__running" data-testid="pi-live-tool-running">
          <button
            type="button"
            className="timeline-live-tool-activity__running-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <MoonwalkGlyph className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-left">
              <span
                className="block text-[12px] font-semibold text-muted-foreground"
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                Tool activity
              </span>
              <span
                className="block truncate text-[13px] leading-tight text-foreground"
                style={{ fontVariationSettings: fontWeights.medium }}
              >
                {label}
              </span>
            </span>
          </button>
          {open && description ? (
            <div className="timeline-live-tool-activity__running-detail text-[12px] leading-snug text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const showIdleFooter =
    !sessionRunning &&
    ((idleChangeSections && idleChangeSections.length > 0) ||
      (idleFooterPills && idleFooterPills.length > 0) ||
      (gitTurnPending && !!worktreePath?.trim()));

  if (showIdleFooter) {
    const summaryCount = idleFooterPills?.length ?? idleChangeSections?.length ?? 0;
    return (
      <div
        className={`timeline-live-tool-activity${exiting ? " timeline-live-tool-activity--exiting" : ""}`}
        data-testid="pi-live-tool-activity"
      >
        {summaryCount > 0 || gitTurnPending ? (
          <div
            className="timeline-live-tool-activity__path-pills"
            data-testid="pi-live-tool-path-pills"
            aria-label="Files changed this turn"
          >
            <span
              className="pi-inline-chip pi-inline-chip--file-changes-summary"
              data-testid="pi-live-tool-files-summary-pill"
              title="Files changed in the most recent agent turn"
            >
              <span className="pi-inline-chip__glyph">Δ</span>
              <span className="pi-inline-chip__label">
                {gitTurnPending && summaryCount === 0
                  ? "Checking file changes…"
                  : `${summaryCount} file${summaryCount === 1 ? "" : "s"} changed`}
              </span>
            </span>
            {idleFooterPills?.map((p) => (
              <span key={p.path} className="pi-inline-chip" title={`${p.kind}: ${p.path}`}>
                <span className="pi-inline-chip__glyph">{pillKindGlyph(p.kind)}</span>
                <span className="pi-inline-chip__label">{p.path}</span>
              </span>
            ))}
          </div>
        ) : null}
        {gitTurnPending && (!idleChangeSections || idleChangeSections.length === 0) ? (
          <div className="timeline-live-tool-activity__git-pending text-[12px] text-muted-foreground px-1 py-2">
            Loading file changes…
          </div>
        ) : null}
        {idleChangeSections && idleChangeSections.length > 0 ? (
          <div className="timeline-live-tool-activity__changes" data-testid="pi-live-tool-file-changes">
            <InlineDiffSections sections={idleChangeSections} />
          </div>
        ) : null}
      </div>
    );
  }

  if (!displayTool) {
    return null;
  }

  const label = displayTool.label?.trim() || displayTool.toolName;
  const description = buildToolDescription(displayTool);

  return (
    <div
      className={cn(
        "timeline-live-tool-activity",
        exiting && "timeline-live-tool-activity--exiting",
      )}
      data-testid="pi-live-tool-activity"
    >
      <div
        className="timeline-live-tool-activity__running timeline-live-tool-activity__running--exit"
        data-testid="pi-live-tool-running"
      >
        <div className="flex min-w-0 items-start gap-2 px-1 py-1">
          <MoonwalkGlyph className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-[13px] leading-tight text-foreground"
              style={{ fontVariationSettings: fontWeights.medium }}
            >
              {label}
            </span>
            {description ? (
              <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{description}</span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
