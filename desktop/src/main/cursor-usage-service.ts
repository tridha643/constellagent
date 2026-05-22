import type { UsageLimitsData } from '../shared/usage-limits-types'

/**
 * Cursor account usage limits are not exposed via a documented public API
 * (Nia search of cursor.com/docs found no rate-limit endpoint). Conductor
 * shows context-window stats only for Cursor until Cursor ships usage data.
 */
export class CursorUsageService {
  async getRateLimits(): Promise<UsageLimitsData | null> {
    return null
  }
}
