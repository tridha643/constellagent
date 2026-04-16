import type { ContextWindowData } from "@shared/context-window-types";
import { Tooltip } from "../components/Tooltip/Tooltip";
import {
  CONTEXT_ZONE_DUMB_AT_PCT,
  CONTEXT_ZONE_WARM_AT_PCT,
  contextZoneArcClassSuffix,
  contextZoneTooltipMetrics,
  getContextZone,
  type ContextZoneName,
} from "./pi-context-zone-tiers";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

/** Shown when usage snapshot is not available yet so the ring stays visible. */
export const PI_CONTEXT_IDLE_DATA: ContextWindowData = {
  usedTokens: 0,
  contextWindowSize: 200_000,
  percentage: 0,
  model: "pi",
  sessionId: "pi-context-idle",
  lastUpdated: 0,
};

/** viewBox side, outer ring r, inner ring r, strokes — tuned for a faint concentric look */
function ringLayout(variant: "default" | "embedded") {
  if (variant === "embedded") {
    return { vb: 26, cx: 13, cy: 13, rOuter: 10.25, swOuter: 1.28, rInner: 7.85, swInner: 1.52 } as const;
  }
  return { vb: 32, cx: 16, cy: 16, rOuter: 12.5, swOuter: 1.38, rInner: 9.6, swInner: 1.72 } as const;
}

function arcClassForZone(zone: ContextZoneName): string {
  const suf = contextZoneArcClassSuffix(zone);
  return `pi-context-ring__arc pi-context-ring__arc--${suf}`;
}

export function PiContextRing({
  data,
  idle,
  variant = "default",
}: {
  readonly data: ContextWindowData;
  /** True when the live session snapshot is not available yet. */
  readonly idle?: boolean;
  /** Compact size for the left edge of the composer textarea. */
  readonly variant?: "default" | "embedded";
}) {
  const L = ringLayout(variant);
  const CIRC = 2 * Math.PI * L.rInner;
  const pct = Math.min(100, Math.max(0, data.percentage));
  const offset = CIRC - (pct / 100) * CIRC;
  const used = data.usedTokens;
  const total = data.contextWindowSize;
  const remaining = Math.max(0, total - used);
  const zone = getContextZone(pct);
  const { nextName, pctOfWindowLeftBeforeNext } = idle
    ? { nextName: "", pctOfWindowLeftBeforeNext: 0 }
    : contextZoneTooltipMetrics(used, total, pct);

  const ariaLabel = idle
    ? "Context usage, waiting for live Pi session data"
    : `Context zone ${zone}, ${formatTokens(used)} of ${formatTokens(total)} tokens, ${pct} percent used`;

  const zoneTitle = (z: ContextZoneName) =>
    z === "smart" ? "Smart" : z === "warm" ? "Warm" : "Dumb";

  const tooltipLabel = idle ? (
    <div className="pi-context-ring-tooltip">
      <div className="pi-context-ring-tooltip__head">Context zones</div>
      <div className="pi-context-ring-tooltip__body">
        After a reply, you’ll see Smart (green), Warm (yellow), and Dumb (red) by how full the window is — same tiers as context-zone style tooling (60% / 85%).
      </div>
    </div>
  ) : (
    <div className="pi-context-ring-tooltip">
      <div className={`pi-context-ring-tooltip__zone pi-context-ring-tooltip__zone--${zone}`}>
        <span className="pi-context-ring-tooltip__zone-label">{zoneTitle(zone)}</span>
        <span className="pi-context-ring-tooltip__zone-caption">context zone</span>
      </div>
      <div className="pi-context-ring-tooltip__legend" aria-hidden>
        <span className="pi-context-ring-tooltip__legend-item pi-context-ring-tooltip__legend-item--smart">
          Smart &lt;{CONTEXT_ZONE_WARM_AT_PCT}%
        </span>
        <span className="pi-context-ring-tooltip__legend-sep">·</span>
        <span className="pi-context-ring-tooltip__legend-item pi-context-ring-tooltip__legend-item--warm">
          Warm {CONTEXT_ZONE_WARM_AT_PCT}–{CONTEXT_ZONE_DUMB_AT_PCT - 1}%
        </span>
        <span className="pi-context-ring-tooltip__legend-sep">·</span>
        <span className="pi-context-ring-tooltip__legend-item pi-context-ring-tooltip__legend-item--dumb">
          Dumb ≥{CONTEXT_ZONE_DUMB_AT_PCT}%
        </span>
      </div>
      <div className="pi-context-ring-tooltip__metric">
        {formatTokens(used)} / {formatTokens(total)} tokens · {pct}% used
      </div>
      <div className="pi-context-ring-tooltip__sub">
        {formatTokens(remaining)} tokens left ·{" "}
        <strong className="pi-context-ring-tooltip__next-pct">
          {pctOfWindowLeftBeforeNext}% of window left before {nextName === "full" ? "full window" : nextName}
        </strong>
      </div>
      <div className="pi-context-ring-tooltip__model">Model: {data.model}</div>
    </div>
  );

  return (
    <Tooltip label={tooltipLabel} multiline position="top">
      <span
        className={`pi-context-ring${idle ? " pi-context-ring--idle" : ""}${
          variant === "embedded" ? " pi-context-ring--embedded" : ""
        }`}
        aria-label={ariaLabel}
      >
        <span className="pi-context-ring__frame">
          <svg
            className="pi-context-ring__svg"
            width={L.vb}
            height={L.vb}
            viewBox={`0 0 ${L.vb} ${L.vb}`}
            aria-hidden
          >
            <circle
              className="pi-context-ring__outer"
              cx={L.cx}
              cy={L.cy}
              r={L.rOuter}
              strokeWidth={L.swOuter}
              fill="none"
            />
            <circle
              className="pi-context-ring__track"
              cx={L.cx}
              cy={L.cy}
              r={L.rInner}
              strokeWidth={L.swInner}
              fill="none"
            />
            <circle
              className={arcClassForZone(zone)}
              cx={L.cx}
              cy={L.cy}
              r={L.rInner}
              strokeWidth={L.swInner}
              fill="none"
              strokeDasharray={CIRC}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${L.cx} ${L.cy})`}
            />
          </svg>
        </span>
      </span>
    </Tooltip>
  );
}
