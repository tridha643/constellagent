/** Opt-in tab-title tracing (`CONSTELLAGENT_TAB_TITLE_DEBUG=1`). */

import { safeConsoleLog } from './main-console'

export function isTabTitleDebugEnabled(): boolean {
  const value = process.env.CONSTELLAGENT_TAB_TITLE_DEBUG?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export function tabTitleDebugLog(...args: unknown[]): void {
  if (!isTabTitleDebugEnabled()) return
  safeConsoleLog(...args)
}
