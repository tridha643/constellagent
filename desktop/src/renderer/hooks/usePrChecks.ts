import { useCallback, useEffect, useRef, useState } from 'react'
import type { GithubLookupError, PrChecksDetail, PrLookupResult } from '@shared/github-types'
import { useAppStore } from '../store/app-store'
import { isStableWorkspaceBranch, normalizeWorkspaceBranch } from '../store/workspace-branch'

/** Fast poll cadence while the Checks tab is the active tab. */
const POLL_INTERVAL = 7_000

export interface UsePrChecksResult {
  detail: PrChecksDetail | null
  /** Initial load only — subsequent polls refresh silently. */
  loading: boolean
  /** gh availability / lookup error (missing, unauth, not-github). */
  error?: GithubLookupError
  /** Whether the workspace is on a stable (non-detached) branch. */
  hasBranch: boolean
  /** Resolved and there is no PR for this branch. */
  noPr: boolean
  refresh: () => void
}

/**
 * Resolve the workspace branch → PR number → per-check detail, then poll while active.
 * PR number resolution (decision #5): `prStatusMap` first, else a one-shot `getPrStatuses`,
 * else `null` ⇒ "No pull request for this branch". Kept separate from the global poller.
 */
export function usePrChecks(opts: {
  projectId: string | undefined
  worktreePath: string | undefined
  branch: string
  active: boolean
}): UsePrChecksResult {
  const { projectId, worktreePath, branch, active } = opts
  const normalizedBranch = normalizeWorkspaceBranch(branch)
  const hasBranch = isStableWorkspaceBranch(normalizedBranch)

  const [detail, setDetail] = useState<PrChecksDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<GithubLookupError | undefined>(undefined)
  const [noPr, setNoPr] = useState(false)

  const runningRef = useRef(false)
  const loadedOnceRef = useRef(false)

  const resolvePrNumber = useCallback(async (): Promise<{
    number: number | null
    error?: GithubLookupError
  }> => {
    if (!projectId || !worktreePath || !hasBranch) return { number: null }
    const key = `${projectId}:${normalizedBranch}`
    const fromMap = useAppStore.getState().prStatusMap.get(key)?.number
    if (typeof fromMap === 'number' && fromMap > 0) return { number: fromMap }
    try {
      const result = (await window.api.github.getPrStatuses(worktreePath, [normalizedBranch])) as PrLookupResult
      // gh missing / unauth / not-github ⇒ surface the notice instead of "No pull request".
      if (!result.available) return { number: null, error: result.error }
      const number = result.data?.[normalizedBranch]?.number
      return { number: typeof number === 'number' && number > 0 ? number : null }
    } catch {
      return { number: null }
    }
  }, [projectId, worktreePath, hasBranch, normalizedBranch])

  const fetchChecks = useCallback(async () => {
    if (runningRef.current) return
    if (!worktreePath || !hasBranch) {
      setDetail(null)
      setNoPr(false)
      setError(undefined)
      setLoading(false)
      loadedOnceRef.current = true
      return
    }
    runningRef.current = true
    if (!loadedOnceRef.current) setLoading(true)
    try {
      const { number: prNumber, error: resolveError } = await resolvePrNumber()
      if (resolveError) {
        setDetail(null)
        setNoPr(false)
        setError(resolveError)
        return
      }
      if (prNumber === null) {
        setDetail(null)
        setNoPr(true)
        setError(undefined)
        return
      }
      const result = await window.api.github.getPrChecks(worktreePath, prNumber)
      if (!result.available) {
        setError(result.error)
        setDetail(null)
        setNoPr(false)
        return
      }
      setError(undefined)
      setNoPr(result.data === null)
      setDetail(result.data)
    } catch {
      // Transient network/IPC error — keep last known state, retry on next tick.
    } finally {
      runningRef.current = false
      loadedOnceRef.current = true
      setLoading(false)
    }
  }, [worktreePath, hasBranch, resolvePrNumber])

  // Reset when the workspace branch / worktree changes so we never show a stale PR.
  useEffect(() => {
    loadedOnceRef.current = false
    setDetail(null)
    setNoPr(false)
    setError(undefined)
  }, [worktreePath, normalizedBranch])

  useEffect(() => {
    if (!active) return
    let disposed = false
    const tick = () => {
      if (!disposed && !document.hidden) void fetchChecks()
    }
    void fetchChecks()
    const interval = setInterval(tick, POLL_INTERVAL)
    const onFocus = () => tick()
    const onVisibility = () => {
      if (!document.hidden) tick()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, fetchChecks])

  const refresh = useCallback(() => {
    void fetchChecks()
  }, [fetchChecks])

  return { detail, loading, error, hasBranch, noPr, refresh }
}
