import { useEffect, useState } from 'react'
import type { ContextWindowData } from '../../shared/context-window-types'
import { CONDUCTOR_CONTEXT_IDLE } from '../../shared/context-window-utils'

export function useConductorContextUsage(sessionId: string | null): {
  data: ContextWindowData
  idle: boolean
} {
  const [data, setData] = useState<ContextWindowData>(CONDUCTOR_CONTEXT_IDLE)
  const idle = !sessionId

  useEffect(() => {
    if (!sessionId) {
      setData(CONDUCTOR_CONTEXT_IDLE)
      return undefined
    }

    let cancelled = false

    const apply = (next: ContextWindowData | null) => {
      if (cancelled) return
      setData(next ?? { ...CONDUCTOR_CONTEXT_IDLE, sessionId })
    }

    void window.api.agentChat
      .getContextUsage(sessionId)
      .then(apply)
      .catch(() => {
        if (!cancelled) setData({ ...CONDUCTOR_CONTEXT_IDLE, sessionId })
      })

    const offContext = window.api.agentChat.onContextChanged((payload) => {
      if (payload.sessionId === sessionId) {
        apply(payload.usage)
      }
    })

    return () => {
      cancelled = true
      offContext()
    }
  }, [sessionId])

  return { data, idle }
}
