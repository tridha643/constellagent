/** Tab label when Gemini CLI OSC title is only an idle placeholder (see pty-manager normalize + emit). */
export const GEMINI_TAB_LABEL = 'Gemini'

export function isGeminiIdleOscTitle(title: string): boolean {
  const t = title.trim().toLowerCase()
  return t === 'ready' || t === 'idle' || t === 'waiting' || t === 'busy'
}
