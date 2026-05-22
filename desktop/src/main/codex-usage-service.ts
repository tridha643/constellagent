import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { UsageLimitWindow, UsageLimitsData } from '../shared/usage-limits-types'
import { limitLabelFromWindowSeconds } from '../shared/usage-limits-format'

const CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json')
const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api'
const USAGE_PATH = '/wham/usage'

interface CodexAuthFile {
  auth_mode?: string
  tokens?: {
    access_token?: string
    account_id?: string
  }
}

interface RateLimitWindowSnapshot {
  used_percent?: number
  limit_window_seconds?: number
  reset_at?: number
}

interface RateLimitStatusDetails {
  primary_window?: RateLimitWindowSnapshot | null
  secondary_window?: RateLimitWindowSnapshot | null
}

interface RateLimitStatusPayload {
  rate_limit?: RateLimitStatusDetails | null
}

function readChatGptAuth(): { accessToken: string; accountId: string } | null {
  try {
    const raw = readFileSync(CODEX_AUTH_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as CodexAuthFile
    if (parsed.auth_mode !== 'chatgpt') return null
    const accessToken = parsed.tokens?.access_token?.trim()
    const accountId = parsed.tokens?.account_id?.trim()
    if (!accessToken || !accountId) return null
    return { accessToken, accountId }
  } catch {
    return null
  }
}

function mapWindow(snapshot: RateLimitWindowSnapshot | null | undefined): UsageLimitWindow | null {
  if (!snapshot || typeof snapshot.used_percent !== 'number') return null
  const usedPercent = Math.max(0, Math.min(100, snapshot.used_percent))
  const label = limitLabelFromWindowSeconds(snapshot.limit_window_seconds)
  const resetsAtMs =
    typeof snapshot.reset_at === 'number' && snapshot.reset_at > 0
      ? snapshot.reset_at * 1000
      : null
  return { label, usedPercent, resetsAtMs }
}

export class CodexUsageService {
  async getRateLimits(): Promise<UsageLimitsData | null> {
    const auth = readChatGptAuth()
    if (!auth) return null

    const url = `${DEFAULT_BASE_URL}${USAGE_PATH}`
    let payload: RateLimitStatusPayload
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'ChatGPT-Account-Id': auth.accountId,
          'User-Agent': 'constellagent',
        },
      })
      if (!res.ok) return null
      payload = (await res.json()) as RateLimitStatusPayload
    } catch {
      return null
    }

    const details = payload.rate_limit
    if (!details) return null

    const primary = mapWindow(details.primary_window)
    const secondary = mapWindow(details.secondary_window)
    if (!primary && !secondary) return null

    return {
      primary,
      secondary,
      lastUpdated: Date.now(),
    }
  }
}
