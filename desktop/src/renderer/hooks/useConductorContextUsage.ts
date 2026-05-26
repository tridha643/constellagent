import { useEffect, useMemo, useState } from 'react'
import type { QueuedAgentMessage } from '../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../shared/conductor-attachments'
import type { ContextWindowData } from '../../shared/context-window-types'
import type { TranscriptMessage } from '../../shared/pi/pi-desktop-state'
import {
  buildComposerContextWindowData,
  CONDUCTOR_CONTEXT_IDLE,
} from '../../shared/context-window-utils'

export interface ConductorContextUsageOptions {
  model?: string
  transcript?: readonly TranscriptMessage[]
  queuedMessages?: readonly QueuedAgentMessage[]
  draftText?: string
  draftAttachments?: readonly ConductorComposerAttachment[]
}

export function useConductorContextUsage(
  sessionId: string | null,
  options: ConductorContextUsageOptions = {},
): {
  data: ContextWindowData
  idle: boolean
} {
  const [baseUsage, setBaseUsage] = useState<ContextWindowData | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setBaseUsage(null)
      return undefined
    }

    let cancelled = false

    const apply = (next: ContextWindowData | null) => {
      if (cancelled) return
      setBaseUsage(next)
    }

    setBaseUsage(null)
    void window.api.agentChat
      .getContextUsage(sessionId)
      .then(apply)
      .catch(() => {
        if (!cancelled) setBaseUsage(null)
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

  const data = useMemo(() => {
    if (
      !sessionId &&
      !options.model &&
      !options.transcript?.length &&
      !options.queuedMessages?.length &&
      !options.draftText &&
      !options.draftAttachments?.length
    ) {
      return CONDUCTOR_CONTEXT_IDLE
    }
    return buildComposerContextWindowData({
      model: options.model ?? baseUsage?.model ?? '',
      sessionId,
      baseUsage,
      transcript: options.transcript,
      queuedMessages: options.queuedMessages,
      draftText: options.draftText,
      draftAttachments: options.draftAttachments,
    })
  }, [
    baseUsage,
    options.draftAttachments,
    options.draftText,
    options.model,
    options.queuedMessages,
    options.transcript,
    sessionId,
  ])

  const idle = data.usedTokens === 0 && !sessionId

  return { data, idle }
}
