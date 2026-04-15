let relaunchRequested = false

export interface RelaunchAppLike {
  relaunch: () => void
  quit: () => void
}

export function requestAppRelaunch(target: RelaunchAppLike): boolean {
  if (relaunchRequested) return false
  relaunchRequested = true
  target.relaunch()
  target.quit()
  return true
}

export function resetAppRelaunchForTests(): void {
  relaunchRequested = false
}
