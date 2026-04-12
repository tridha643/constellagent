import type { Toast } from '../store/types'

const STALE_MAIN_TOAST_COOLDOWN_MS = 5000

export const STALE_MAIN_IPC_MESSAGE =
  'Main process is out of date. Quit Constellagent (Cmd+Q) and run `bun run dev` again. Reload (Cmd+R) only updates the UI, not IPC handlers.'

let lastStaleMainToastAt = 0

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isMissingIpcHandlerError(err: unknown): boolean {
  return errorMessage(err).includes('No handler registered')
}

export function maybeShowStaleMainToast(
  err: unknown,
  addToast: (toast: Toast) => void,
): boolean {
  if (!isMissingIpcHandlerError(err)) return false

  const now = Date.now()
  if (now - lastStaleMainToastAt < STALE_MAIN_TOAST_COOLDOWN_MS) {
    return true
  }

  lastStaleMainToastAt = now
  addToast({
    id: `stale-main-ipc-${now}`,
    message: STALE_MAIN_IPC_MESSAGE,
    type: 'error',
  })
  return true
}
