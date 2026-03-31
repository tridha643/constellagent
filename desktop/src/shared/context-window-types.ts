export interface ContextWindowData {
  usedTokens: number
  contextWindowSize: number
  percentage: number // 0–100
  model: string
  sessionId: string
  lastUpdated: number // epoch ms
}
