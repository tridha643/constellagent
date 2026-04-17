export const springs = {
  /** ~80ms, no overshoot — use for micro opacity/transform (not true physics spring). */
  tweenMicro: {
    type: "spring" as const,
    duration: 0.08,
    bounce: 0,
  },
  /** @deprecated Use `tweenMicro` — misnamed; this is a short tween, not a snappy spring. */
  fast: {
    type: "spring" as const,
    duration: 0.08,
    bounce: 0,
  },
  moderate: {
    type: "spring" as const,
    duration: 0.16,
    bounce: 0.15,
  },
  slow: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0.15,
  },
  /** Height / layout — never use bounce on layout-driving props */
  layout: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0,
  },
  noBounce: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0,
  },
} as const;
