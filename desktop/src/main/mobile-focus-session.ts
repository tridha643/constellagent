import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'

export interface MobileFocusSessionPayload {
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspacePath: string
  readonly title?: string
}

export function broadcastMobileFocusSession(payload: MobileFocusSessionPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC.MOBILE_FOCUS_SESSION, payload)
  }
}
