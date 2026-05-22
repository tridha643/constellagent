import { useEffect, useRef } from 'react'
import type { AgentProvider } from '../../shared/agent-chat-types'
import type { UsageLimitsData } from '../../shared/usage-limits-types'
import { useAppStore } from '../store/app-store'

const POLL_INTERVAL = 60_000

export function useUsageLimitsPoller(provider: AgentProvider): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let disposed = false

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    async function poll() {
      if (disposed || document.hidden) return

      const { setUsageLimitsData } = useAppStore.getState()

      if (provider === 'codex') {
        try {
          const data = await window.api.codex.getRateLimits()
          if (!disposed) setUsageLimitsData(data)
        } catch {
          if (!disposed) setUsageLimitsData(null)
        }
      } else {
        setUsageLimitsData(null)
      }

      schedule()
    }

    function schedule() {
      if (disposed || document.hidden) return
      clearTimer()
      timerRef.current = setTimeout(() => void poll(), POLL_INTERVAL)
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer()
      } else {
        void poll()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    void poll()

    return () => {
      disposed = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (provider !== 'codex') {
        useAppStore.getState().setUsageLimitsData(null)
      }
    }
  }, [provider])
}

export function useConductorUsageLimits(): { data: UsageLimitsData | null } {
  const data = useAppStore((s) => s.usageLimitsData)
  return { data }
}
