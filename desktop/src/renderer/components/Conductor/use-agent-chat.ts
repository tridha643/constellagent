import { useCallback, useEffect, useState } from 'react'
import type { AgentChatSessionState, QueuedAgentMessage, QueuedAgentMessageMode } from '../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../shared/conductor-thinking'
import { applyAssistantDeltaToTranscript } from '../../../shared/conductor-transcript-utils'
import type { TranscriptMessage } from '../../../shared/pi/pi-desktop-state'

/** Lists Conductor sessions for a workspace, kept fresh via state-change events. */
export function useConductorSessions(workspaceId: string | null): {
  sessions: AgentChatSessionState[]
  refresh: () => void
} {
  const [sessions, setSessions] = useState<AgentChatSessionState[]>([])

  const refresh = useCallback(() => {
    if (!workspaceId) {
      setSessions([])
      return
    }
    void window.api.agentChat.listSessions(workspaceId).then(setSessions).catch(() => setSessions([]))
  }, [workspaceId])

  useEffect(() => {
    refresh()
    const off = window.api.agentChat.onStateChanged((state) => {
      if (state.workspaceId !== workspaceId) return
      setSessions((prev) => {
        const next = prev.filter((s) => s.sessionId !== state.sessionId)
        next.unshift(state)
        return next
      })
    })
    return off
  }, [workspaceId, refresh])

  return { sessions, refresh }
}

export interface ConductorSessionController {
  state: AgentChatSessionState | null
  transcript: TranscriptMessage[]
  submit: (text: string, deliverAs?: QueuedAgentMessageMode) => void
  cancel: () => void
  replaceQueue: (messages: readonly QueuedAgentMessage[]) => void
  setModel: (model: string) => void
  setPlan: (plan: boolean) => void
  setThinkingLevel: (level: ThinkingLevel) => void
}

/** Subscribes to a single session's state + transcript and exposes actions. */
export function useConductorSession(sessionId: string | null): ConductorSessionController {
  const [state, setState] = useState<AgentChatSessionState | null>(null)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])

  useEffect(() => {
    if (!sessionId) {
      setState(null)
      setTranscript([])
      return
    }
    let active = true
    // Once a live event arrives, the initial getSession() snapshot is stale.
    let liveStateSeen = false
    let liveUpdateSeen = false
    void window.api.agentChat.getSession(sessionId).then((res) => {
      if (!active || !res) return
      if (!liveStateSeen) setState(res.state)
      if (!liveUpdateSeen) setTranscript([...res.transcript])
    }).catch(() => {
      if (!active) return
      setState(null)
      setTranscript([])
    })
    const offState = window.api.agentChat.onStateChanged((s) => {
      if (s.sessionId === sessionId) {
        liveStateSeen = true
        setState(s)
      }
    })
    const offTranscript = window.api.agentChat.onTranscriptChanged((payload) => {
      if (payload.sessionId === sessionId) {
        liveUpdateSeen = true
        setTranscript([...payload.transcript])
      }
    })
    const offDelta = window.api.agentChat.onAssistantDelta((payload) => {
      if (payload.sessionId !== sessionId) return
      liveUpdateSeen = true
      setTranscript((prev) =>
        applyAssistantDeltaToTranscript(prev, payload.messageId, payload.text),
      )
    })
    return () => {
      active = false
      offState()
      offTranscript()
      offDelta()
    }
  }, [sessionId])

  const submit = useCallback(
    (text: string, deliverAs?: QueuedAgentMessageMode) => {
      if (sessionId) void window.api.agentChat.submit(sessionId, text, deliverAs).catch(() => {})
    },
    [sessionId],
  )

  const replaceQueue = useCallback(
    (messages: readonly QueuedAgentMessage[]) => {
      if (sessionId) void window.api.agentChat.replaceQueue(sessionId, messages).catch(() => {})
    },
    [sessionId],
  )

  const cancel = useCallback(() => {
    if (sessionId) void window.api.agentChat.cancel(sessionId).catch(() => {})
  }, [sessionId])

  const setModel = useCallback(
    (model: string) => {
      if (!sessionId) return
      setState((prev) => (prev ? { ...prev, model, error: undefined } : prev))
      void window.api.agentChat.setModel(sessionId, model).catch(() => {})
    },
    [sessionId],
  )

  const setPlan = useCallback(
    (plan: boolean) => {
      if (!sessionId) return
      setState((prev) => (prev ? { ...prev, plan, error: undefined } : prev))
      void window.api.agentChat.setPlan(sessionId, plan).catch(() => {})
    },
    [sessionId],
  )

  const setThinkingLevel = useCallback(
    (thinkingLevel: ThinkingLevel) => {
      if (!sessionId) return
      setState((prev) => (prev ? { ...prev, thinkingLevel, error: undefined } : prev))
      void window.api.agentChat.setThinkingLevel(sessionId, thinkingLevel).catch(() => {})
    },
    [sessionId],
  )

  return { state, transcript, submit, cancel, replaceQueue, setModel, setPlan, setThinkingLevel }
}
