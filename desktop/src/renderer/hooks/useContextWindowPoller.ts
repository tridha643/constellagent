import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/app-store'

const POLL_INTERVAL = 5_000
const STALE_THRESHOLD = 30_000

export function useContextWindowPoller(): void {
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

      const {
        activeWorkspaceId,
        activeClaudeWorkspaceIds,
        workspaces,
        setContextWindowData,
      } = useAppStore.getState()

      if (!activeWorkspaceId || !activeClaudeWorkspaceIds.has(activeWorkspaceId)) {
        // Check if we should keep showing data briefly after agent finishes
        const prev = useAppStore.getState().contextWindowData
        if (prev && Date.now() - prev.lastUpdated > STALE_THRESHOLD) {
          setContextWindowData(null)
        }
        schedule()
        return
      }

      const ws = workspaces.find((w) => w.id === activeWorkspaceId)
      if (!ws?.worktreePath) {
        setContextWindowData(null)
        schedule()
        return
      }

      try {
        const data = await window.api.claude.getContextWindow(ws.worktreePath)
        if (!disposed) {
          setContextWindowData(data)
        }
      } catch {
        // Graceful degradation
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
    }
  }, [])
}
