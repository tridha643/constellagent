export type TerminalSessionBackend = 'tmux' | 'local'

export type TerminalSessionStatus = 'attached' | 'detached' | 'missing' | 'error'

export interface TerminalSessionAvailability {
  available: boolean
  backend: TerminalSessionBackend
  tmuxPath?: string
  version?: string
  error?: string
}

export interface TerminalSessionAttachRequest {
  workspaceId: string
  terminalId: string
  cwd: string
  shell?: string
  sessionName?: string
  /**
   * Command to run inside the session the moment it is created (e.g. a
   * package.json script launched from the Setup panel). For tmux it is typed
   * into the persistent session via send-keys so it keeps running across
   * detach/reattach; for the local fallback it is exec'd through the login
   * shell. Ignored on reattach (the process is already running).
   */
  initialCommand?: string
}

export interface TerminalSessionAttachResult {
  backend: TerminalSessionBackend
  terminalId: string
  sessionName?: string
  ptyId: string
  status: Extract<TerminalSessionStatus, 'attached'>
}

export interface TerminalSessionSummary {
  backend: Extract<TerminalSessionBackend, 'tmux'>
  sessionName: string
  workspaceId: string | null
  terminalId: string | null
  createdAt?: number
  attachedClients?: number
}
