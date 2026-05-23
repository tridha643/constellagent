import { useCallback, useEffect, useState } from 'react'
import type { AgentChatSessionState, QueuedAgentMessage, QueuedAgentMessageMode } from '../../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../../shared/conductor-attachments'
import type { ConductorBlockingQuestionResponse } from '../../../shared/conductor-ask-question-types'
import type { ThinkingLevel } from '../../../shared/conductor-thinking'
import { applyAssistantDeltaToTranscript } from '../../../shared/conductor-transcript-utils'
import type { TranscriptMessage } from '../../../shared/pi/pi-desktop-state'
import { logPerfEvent } from '../../utils/perf'

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
  submit: (
    text: string,
    deliverAs?: QueuedAgentMessageMode,
    attachments?: readonly ConductorComposerAttachment[],
  ) => void
  cancel: () => void
  replaceQueue: (messages: readonly QueuedAgentMessage[]) => void
  setModel: (model: string) => void
  setPlan: (plan: boolean) => void
  setCanvas: (canvas: boolean) => void
  setThinkingLevel: (level: ThinkingLevel) => void
  respondBlockingQuestion: (response: ConductorBlockingQuestionResponse) => void
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
        const started = performance.now()
        setTranscript([...payload.transcript])
        logPerfEvent('conductor.transcript_replace', performance.now() - started, {
          transcriptSize: payload.transcript.length,
        })
      }
    })
    const offDelta = window.api.agentChat.onAssistantDelta((payload) => {
      if (payload.sessionId !== sessionId) return
      liveUpdateSeen = true
      setTranscript((prev) => {
        const started = performance.now()
        const next = applyAssistantDeltaToTranscript(prev, payload.messageId, payload.text)
        logPerfEvent('conductor.assistant_delta_apply', performance.now() - started, {
          transcriptSize: prev.length,
          chars: payload.text.length,
        })
        return next
      })
    })
    return () => {
      active = false
      offState()
      offTranscript()
      offDelta()
    }
  }, [sessionId])

  const submit = useCallback(
    (
      text: string,
      deliverAs?: QueuedAgentMessageMode,
      attachments?: readonly ConductorComposerAttachment[],
    ) => {
      if (sessionId) {
        void window.api.agentChat.submit(sessionId, text, deliverAs, attachments).catch(() => {})
      }
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

  const setCanvas = useCallback(
    (canvas: boolean) => {
      if (!sessionId) return
      setState((prev) => (prev ? { ...prev, canvas, error: undefined } : prev))
      void window.api.agentChat.setCanvas(sessionId, canvas).catch(() => {})
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

  const respondBlockingQuestion = useCallback(
    (response: ConductorBlockingQuestionResponse) => {
      if (!sessionId) return
      void window.api.agentChat.respondBlockingQuestion(sessionId, response).catch(() => {})
    },
    [sessionId],
  )

  return { state, transcript, submit, cancel, replaceQueue, setModel, setPlan, setCanvas, setThinkingLevel, respondBlockingQuestion }
}
