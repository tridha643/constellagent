import type { ConductorAuthStatus } from '../../shared/agent-chat-types'
import type { CodexWebSocketsSetting } from '../../shared/codex-websockets'
import type { AppState } from '../store/types'

/** Where users create Cursor API keys for the SDK (see cursor.com/docs/api). */
export const CURSOR_API_KEY_DOCS_URL = 'https://cursor.com/docs/api/sdk/typescript'

type SignInStore = Pick<
  AppState,
  'activeWorkspaceId' | 'workspaces' | 'launchAgentTerminalWithCommand' | 'addToast'
>

export async function syncConductorAuthKeys(
  cursorApiKey: string,
  openaiApiKey: string,
  codexWebSockets?: CodexWebSocketsSetting,
): Promise<void> {
  try {
    await window.api.agentChat.syncAuth({ cursorApiKey, openaiApiKey, codexWebSockets })
  } catch {
    // Main process not reloaded yet (dev ⌘R only refreshes renderer).
  }
}

export async function fetchConductorAuthStatus(force = false): Promise<ConductorAuthStatus | null> {
  try {
    return await window.api.agentChat.getAuthStatus(force)
  } catch {
    return null
  }
}

export function openCursorApiKeyDocs(): void {
  void window.api.app.openExternal(CURSOR_API_KEY_DOCS_URL)
}

/** Spawns a terminal running `cursor-agent login` in the active workspace (or first workspace). */
export async function signInCursor(getState: () => SignInStore): Promise<string | null> {
  const { activeWorkspaceId, workspaces, launchAgentTerminalWithCommand, addToast } = getState()
  const ws =
    workspaces.find((w) => w.id === activeWorkspaceId) ??
    workspaces[0] ??
    null
  if (!ws) {
    addToast({
      id: crypto.randomUUID(),
      type: 'error',
      message: 'Open or create a workspace first, then run Cursor sign-in.',
    })
    return null
  }
  await launchAgentTerminalWithCommand({
    workspaceId: ws.id,
    worktreePath: ws.worktreePath,
    title: 'Cursor login',
    command: 'cursor-agent login',
    agentType: 'cursor',
  })
  return ws.id
}

/** Spawns a terminal running `codex login` in the active workspace (or first workspace). */
export async function signInCodex(getState: () => SignInStore): Promise<string | null> {
  const { activeWorkspaceId, workspaces, launchAgentTerminalWithCommand, addToast } = getState()
  const ws =
    workspaces.find((w) => w.id === activeWorkspaceId) ??
    workspaces[0] ??
    null
  if (!ws) {
    addToast({
      id: crypto.randomUUID(),
      type: 'error',
      message: 'Open or create a workspace first, then run Codex sign-in.',
    })
    return null
  }
  await launchAgentTerminalWithCommand({
    workspaceId: ws.id,
    worktreePath: ws.worktreePath,
    title: 'Codex login',
    command: 'codex login',
    agentType: 'codex',
  })
  return ws.id
}
