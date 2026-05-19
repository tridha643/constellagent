export type SpotlightState =
  | 'idle'
  | 'preparing'
  | 'syncing'
  | 'watching'
  | 'restoring'
  | 'blocked'
  | 'error'

export type SpotlightMode = 'fast' | 'safe-submodules'

export interface SpotlightStatus {
  projectId: string
  workspaceId: string | null
  state: SpotlightState
  mode?: SpotlightMode
  lastSyncAt?: number
  message?: string
}
