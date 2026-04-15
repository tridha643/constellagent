import type { Tab } from '../../store/types'

export function hasUnsavedFilesForRestart(tabs: Tab[]): boolean {
  return tabs.some((tab) => tab.type === 'file' && tab.unsaved)
}

export function shouldConfirmAppRestart(confirmOnClose: boolean, tabs: Tab[]): boolean {
  return confirmOnClose && hasUnsavedFilesForRestart(tabs)
}
