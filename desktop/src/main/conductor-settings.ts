import {
  DEFAULT_CODEX_WEBSOCKETS_SETTING,
  normalizeCodexWebSocketsSetting,
  type CodexWebSocketsSetting,
} from '../shared/codex-websockets'

let conductorCodexWebSocketsSetting: CodexWebSocketsSetting = DEFAULT_CODEX_WEBSOCKETS_SETTING

export function getConductorCodexWebSocketsSetting(): CodexWebSocketsSetting {
  return conductorCodexWebSocketsSetting
}

export function setConductorCodexWebSocketsSetting(value: unknown): void {
  conductorCodexWebSocketsSetting = normalizeCodexWebSocketsSetting(value)
}

export function applyConductorSettingsFromPersistedState(data: unknown): void {
  const settings = (data as { settings?: Record<string, unknown> } | null)?.settings
  setConductorCodexWebSocketsSetting(settings?.conductorCodexWebSockets)
}
