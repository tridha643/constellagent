import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import {
  CONDUCTOR_PROVIDER_LABELS,
  type AgentProvider,
  type ConductorAuthStatus,
} from '../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../shared/conductor-thinking'
import { normalizeThinkingLevel } from '../../../shared/conductor-thinking'
import {
  normalizeConductorDefaultProvider,
  normalizeConductorDefaultModel,
  resolveConductorDefaultSelection,
  toConductorDraftSelection,
  setModelFast,
} from '../../../shared/conductor-model-utils'
import type { Tab } from '../../store/types'
import { ChatTimeline, type ChatTimelineHandle } from './chat/ChatTimeline'
import { ChatComposer, type ChatComposerHandle } from './chat/ChatComposer'
import { useConductorSession } from './use-agent-chat'
import {
  fetchConductorAuthStatus,
  signInCodex,
  signInCursor,
  syncConductorAuthKeys,
} from '../../lib/conductor-sign-in'
import styles from './Conductor.module.css'

export type ConductorTab = Extract<Tab, { type: 'conductor' }>

export function ConductorChatView({
  tab,
  workspaceId,
  worktreePath,
  active,
}: {
  tab: ConductorTab
  workspaceId: string
  worktreePath: string
  active: boolean
}) {
  const setConductorTabSessionBinding = useAppStore((s) => s.setConductorTabSessionBinding)
  const openConductorSessionTab = useAppStore((s) => s.openConductorSessionTab)
  const openSettingsSection = useAppStore((s) => s.openSettingsSection)
  const conductorCursorApiKey = useAppStore((s) => s.settings.conductorCursorApiKey)
  const conductorOpenaiApiKey = useAppStore((s) => s.settings.conductorOpenaiApiKey)
  const conductorDefaultProviderSetting = useAppStore((s) => s.settings.conductorDefaultProvider)
  const conductorDefaultModelSetting = useAppStore((s) => s.settings.conductorDefaultModel)

  const agentSessionId = tab.agentSessionId ?? null
  const [draftProvider, setDraftProvider] = useState<AgentProvider>(() => {
    return normalizeConductorDefaultProvider(conductorDefaultProviderSetting)
  })
  const [draftModel, setDraftModel] = useState<string>(() => {
    const provider = normalizeConductorDefaultProvider(conductorDefaultProviderSetting)
    return resolveConductorDefaultSelection(
      provider,
      normalizeConductorDefaultModel(conductorDefaultModelSetting),
    ).model
  })
  const [draftThinkingLevel, setDraftThinkingLevel] = useState<ThinkingLevel>(() => {
    const provider = normalizeConductorDefaultProvider(conductorDefaultProviderSetting)
    return resolveConductorDefaultSelection(
      provider,
      normalizeConductorDefaultModel(conductorDefaultModelSetting),
    ).thinkingLevel
  })
  const [draftPlan, setDraftPlan] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<ConductorAuthStatus | null>(null)
  const [cursorLoginStarted, setCursorLoginStarted] = useState(false)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [forking, setForking] = useState(false)
  const composerRef = useRef<ChatComposerHandle | null>(null)
  const timelineRef = useRef<ChatTimelineHandle | null>(null)

  useEffect(() => {
    void syncConductorAuthKeys(conductorCursorApiKey, conductorOpenaiApiKey)
    void fetchConductorAuthStatus(true).then(setAuthStatus)
  }, [conductorCursorApiKey, conductorOpenaiApiKey])

  useEffect(() => {
    if (!cursorLoginStarted) return
    const timer = setInterval(() => {
      void fetchConductorAuthStatus(true).then(setAuthStatus)
    }, 2000)
    return () => clearInterval(timer)
  }, [cursorLoginStarted])

  const controller = useConductorSession(agentSessionId)

  const provider = controller.state?.provider ?? draftProvider
  const model = controller.state?.model ?? draftModel
  const thinkingLevel = normalizeThinkingLevel(controller.state?.thinkingLevel ?? draftThinkingLevel)
  const plan = controller.state?.plan ?? draftPlan
  const running = controller.state?.status === 'running'

  useEffect(() => {
    if (running) {
      setRunStartedAt((prev) => prev ?? Date.now())
    } else {
      setRunStartedAt(null)
    }
  }, [running])

  const providerAuth = authStatus?.[provider]
  const sessionError = controller.state?.error ?? null
  const visibleSessionError =
    sessionError && sessionError !== dismissedError ? sessionError : null
  const signInHint =
    providerAuth && !providerAuth.ready
      ? `${CONDUCTOR_PROVIDER_LABELS[provider]}: ${providerAuth.detail}`
      : null

  useEffect(() => {
    setDismissedError(null)
  }, [agentSessionId])

  useEffect(() => {
    const sessionTitle = controller.state?.title?.trim()
    if (!sessionTitle || !agentSessionId) return
    if (tab.title !== sessionTitle) {
      setConductorTabSessionBinding(tab.id, agentSessionId, sessionTitle)
    }
  }, [controller.state?.title, agentSessionId, tab.id, tab.title, setConductorTabSessionBinding])

  const formatChatError = (message: string): string => {
    if (message.includes('No handler registered')) {
      return 'Conductor backend is out of date — quit and restart the app (dev: restart bun run dev, not just ⌘R).'
    }
    return message
  }

  const createSession = async (
    nextProvider: AgentProvider,
    nextModel: string,
    title?: string,
    nextThinkingLevel?: ThinkingLevel,
  ): Promise<string | null> => {
    const created = await window.api.agentChat.createSession({
      workspaceId,
      workspacePath: worktreePath,
      provider: nextProvider,
      model: nextModel,
      title,
      plan,
      thinkingLevel: nextThinkingLevel ?? thinkingLevel,
    })
    setConductorTabSessionBinding(tab.id, created.sessionId, title ?? tab.title)
    return created.sessionId
  }

  const handleSubmit = async (text: string) => {
    setSubmitError(null)
    try {
      let id = agentSessionId
      if (!id) {
        id = await createSession(draftProvider, draftModel, text.slice(0, 48))
      }
      if (id) await window.api.agentChat.submit(id, text)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSubmitError(formatChatError(message))
    }
  }

  const handleSelectModel = (nextProvider: AgentProvider, nextModel: string) => {
    const { model: storedModel, thinkingLevel: level } = toConductorDraftSelection(nextModel)
    if (controller.state) {
      if (controller.state.provider === nextProvider) {
        controller.setModel(storedModel)
        controller.setThinkingLevel(level)
      } else {
        void createSession(nextProvider, storedModel, undefined, level)
      }
    } else {
      setDraftProvider(nextProvider)
      setDraftModel(storedModel)
      setDraftThinkingLevel(level)
    }
  }

  const handleSetThinkingLevel = (level: ThinkingLevel) => {
    setDraftThinkingLevel(level)
    if (agentSessionId) {
      controller.setThinkingLevel(level)
    }
  }

  const handleToggleFast = (fast: boolean) => {
    const nextModel = setModelFast(model, fast)
    setDraftModel(nextModel)
    setSubmitError(null)
    if (agentSessionId) {
      controller.setModel(nextModel)
    }
  }

  const handleSetPlan = (nextPlan: boolean) => {
    setDraftPlan(nextPlan)
    setSubmitError(null)
    if (agentSessionId) {
      controller.setPlan(nextPlan)
    }
  }

  const handleForkFromMessage = async (messageId: string) => {
    if (!agentSessionId || forking) return
    setSubmitError(null)
    setForking(true)
    try {
      const created = await window.api.agentChat.forkSession({
        sourceSessionId: agentSessionId,
        upToMessageId: messageId,
      })
      openConductorSessionTab(created.sessionId, created.title)
      composerRef.current?.focus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSubmitError(message)
    } finally {
      setForking(false)
    }
  }

  const handleSelectHistoryTurn = (messageId: string, refillComposer: boolean) => {
    timelineRef.current?.scrollToMessage(messageId)
    if (refillComposer) {
      const item = controller.transcript.find((t) => t.kind === 'message' && t.id === messageId)
      if (item?.kind === 'message' && item.role === 'user') {
        composerRef.current?.setText(item.text)
      }
    }
  }

  return (
    <div className={styles.chatView} data-active={active} data-testid="conductor-chat-view">
        <ChatTimeline
          ref={timelineRef}
          transcript={controller.transcript}
          running={running}
          runStartedAt={runStartedAt}
          planActive={plan}
          onSelectHistoryTurn={handleSelectHistoryTurn}
          onFork={handleForkFromMessage}
          forkDisabled={forking}
          provider={provider}
          model={model}
          thinkingLevel={thinkingLevel}
        />
        {(visibleSessionError || submitError) && (
          <div className={styles.composerError} role="alert">
            <span>{visibleSessionError ?? submitError}</span>
            <button
              type="button"
              className={styles.composerErrorDismiss}
              aria-label="Dismiss"
              onClick={() => {
                if (visibleSessionError) setDismissedError(visibleSessionError)
                else setSubmitError(null)
              }}
            >
              ×
            </button>
          </div>
        )}
        {signInHint && !visibleSessionError && !submitError && (
          <div className={styles.authNotice}>
            <span>{signInHint}</span>
            <span className={styles.authNoticeActions}>
              {provider === 'cursor' ? (
                <button
                  type="button"
                  className={styles.authSignInBtn}
                  onClick={() => {
                    setCursorLoginStarted(true)
                    void signInCursor(useAppStore.getState)
                    void fetchConductorAuthStatus(true).then(setAuthStatus)
                  }}
                >
                  Sign in with Cursor
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.authSignInBtn}
                  onClick={() => {
                    void signInCodex(useAppStore.getState)
                    void fetchConductorAuthStatus(true).then(setAuthStatus)
                  }}
                >
                  Sign in with Codex
                </button>
              )}
              <button
                type="button"
                className={styles.authNoticeLink}
                onClick={() => openSettingsSection('conductor')}
              >
                Settings
              </button>
            </span>
          </div>
        )}
        <ChatComposer
          provider={provider}
          model={model}
          thinkingLevel={thinkingLevel}
          plan={plan}
          running={running}
          disabled={!worktreePath}
          onSubmit={handleSubmit}
          onCancel={controller.cancel}
          onSetModel={handleSelectModel}
          onSetThinkingLevel={handleSetThinkingLevel}
          onToggleFast={handleToggleFast}
          onSetPlan={handleSetPlan}
          onHistoryUp={() => timelineRef.current?.openHistory()}
          composerRef={composerRef}
        />
    </div>
  )
}
