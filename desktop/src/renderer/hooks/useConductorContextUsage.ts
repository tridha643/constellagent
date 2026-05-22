import { useEffect, useState } from 'react'
import type { ContextWindowData } from '../../shared/context-window-types'
import { CONDUCTOR_CONTEXT_IDLE } from '../../shared/context-window-utils'

const POLL_MS = 4_000

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

    const refresh = () => {
      void window.api.agentChat.getContextUsage(sessionId).then(apply).catch(() => {
        if (!cancelled) setData({ ...CONDUCTOR_CONTEXT_IDLE, sessionId })
      })
    }

    refresh()
    const pollId = setInterval(refresh, POLL_MS)
    const offContext = window.api.agentChat.onContextChanged((payload) => {
      if (payload.sessionId === sessionId) {
        apply(payload.usage)
      }
    })
    const offTranscript = window.api.agentChat.onTranscriptChanged((payload) => {
      if (payload.sessionId === sessionId) {
        refresh()
      }
    })

    return () => {
      cancelled = true
      clearInterval(pollId)
      offContext()
      offTranscript()
    }
  }, [sessionId])

  return { data, idle }
}
