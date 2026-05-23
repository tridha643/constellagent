export type CodexWebSocketsSetting = 'auto' | 'off'

export const DEFAULT_CODEX_WEBSOCKETS_SETTING: CodexWebSocketsSetting = 'auto'

export function normalizeCodexWebSocketsSetting(value: unknown): CodexWebSocketsSetting {
  return value === 'off' ? 'off' : DEFAULT_CODEX_WEBSOCKETS_SETTING
}
