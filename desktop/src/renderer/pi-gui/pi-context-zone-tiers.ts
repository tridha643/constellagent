/**
 * Context-zone style tiers for the Pi context ring (Smart / Warm / Dumb).
 * Thresholds match the arc colors: 60% → warm (yellow), 85% → dumb (red).
 */
export const CONTEXT_ZONE_WARM_AT_PCT = 60;
export const CONTEXT_ZONE_DUMB_AT_PCT = 85;

export type ContextZoneName = "smart" | "warm" | "dumb";

export function getContextZone(usedPct: number): ContextZoneName {
  const p = Math.min(100, Math.max(0, usedPct));
  if (p >= CONTEXT_ZONE_DUMB_AT_PCT) return "dumb";
  if (p >= CONTEXT_ZONE_WARM_AT_PCT) return "warm";
  return "smart";
}

/** Ring SVG arc class suffix (low / mid / high). */
export function contextZoneArcClassSuffix(zone: ContextZoneName): "low" | "mid" | "high" {
  switch (zone) {
    case "smart":
      return "low";
    case "warm":
      return "mid";
    case "dumb":
      return "high";
  }
}

function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Zone, next boundary name, and % of the context window still unused before that boundary.
 * “Next version” in UI copy = crossing into the next zone (or running out of window in Dumb).
 */
export function contextZoneTooltipMetrics(
  usedTokens: number,
  contextWindowSize: number,
  displayUsedPct: number,
): { zone: ContextZoneName; nextName: string; pctOfWindowLeftBeforeNext: number } {
  const total = Math.max(1, contextWindowSize);
  const used = Math.max(0, usedTokens);
  const zone = getContextZone(displayUsedPct);

  if (zone === "smart") {
    const tokensUntilWarm = (CONTEXT_ZONE_WARM_AT_PCT / 100) * total - used;
    const pctOfWindowLeftBeforeNext = Math.max(0, (tokensUntilWarm / total) * 100);
    return { zone, nextName: "Warm", pctOfWindowLeftBeforeNext: roundPct(pctOfWindowLeftBeforeNext) };
  }
  if (zone === "warm") {
    const tokensUntilDumb = (CONTEXT_ZONE_DUMB_AT_PCT / 100) * total - used;
    const pctOfWindowLeftBeforeNext = Math.max(0, (tokensUntilDumb / total) * 100);
    return { zone, nextName: "Dumb", pctOfWindowLeftBeforeNext: roundPct(pctOfWindowLeftBeforeNext) };
  }
  const tokensUntilFull = total - used;
  const pctOfWindowLeftBeforeNext = Math.max(0, (tokensUntilFull / total) * 100);
  return { zone, nextName: "full", pctOfWindowLeftBeforeNext: roundPct(pctOfWindowLeftBeforeNext) };
}
