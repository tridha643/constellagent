export interface UsageLimitWindow {
  /** Short label such as "5h" or "7d". */
  label: string
  /** Percent of the window consumed (0–100). */
  usedPercent: number
  /** Unix epoch ms when the window resets, or null if unknown. */
  resetsAtMs: number | null
}

export interface UsageLimitsData {
  primary: UsageLimitWindow | null
  secondary: UsageLimitWindow | null
  lastUpdated: number
}
