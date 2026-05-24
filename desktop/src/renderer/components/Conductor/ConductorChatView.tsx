import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import {
  CONDUCTOR_PROVIDER_LABELS,
  type AgentProvider,
  type ConductorAuthStatus,
  type QueuedAgentMessage,
  type QueuedAgentMessageMode,
} from '../../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../../shared/conductor-attachments'
import type { ConductorSlashCommand } from '../../../shared/conductor-composer-commands'
import type { ThinkingLevel } from '../../../shared/conductor-thinking'
import { normalizeThinkingLevel } from '../../../shared/conductor-thinking'
import {
  normalizeConductorDefaultProvider,
  normalizeConductorDefaultModel,
  resolveConductorDefaultSelection,
  toConductorDraftSelection,
  setModelFast,
  hasFastVariant,
} from '../../../shared/conductor-model-utils'
import type { Tab } from '../../store/types'
import { ChatTimeline, type ChatTimelineHandle } from './chat/ChatTimeline'
import { ChatComposer, type ChatComposerHandle } from './chat/ChatComposer'
import { ConductorEmbeddedTerminal } from './chat/ConductorEmbeddedTerminal'
import { ConductorMcpStatusPanel } from './chat/ConductorMcpStatusPanel'
import { ConductorMcpTerminalBanner } from './chat/ConductorMcpTerminalBanner'
import { APPROVE_PLAN_MESSAGE, getLatestPlanApprovalMessageId } from './chat/plan-approval'
import { ConductorAskQuestionModal } from './chat/ConductorAskQuestionModal'
import { useConductorSession } from './use-agent-chat'
import {
  fetchConductorAuthStatus,
  signInCodex,
  signInCursor,
  syncConductorAuthKeys,
} from '../../lib/conductor-sign-in'
import { SharedFileIconDefs } from '../../utils/file-presentation'
import { useConductorChatTypographyScope } from './useConductorChatTypographyScope'
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
  const removeTab = useAppStore((s) => s.removeTab)
  const createConductorTabForActiveWorkspace = useAppStore((s) => s.createConductorTabForActiveWorkspace)
  const conductorCursorApiKey = useAppStore((s) => s.settings.conductorCursorApiKey)
  const conductorOpenaiApiKey = useAppStore((s) => s.settings.conductorOpenaiApiKey)
  const conductorDefaultProviderSetting = useAppStore((s) => s.settings.conductorDefaultProvider)
  const conductorDefaultModelSetting = useAppStore((s) => s.settings.conductorDefaultModel)
  const conductorDefaultThinkingLevelSetting = useAppStore(
    (s) => s.settings.conductorDefaultThinkingLevel,
  )
  const conductorCodexWebSocketsSetting = useAppStore((s) => s.settings.conductorCodexWebSockets)
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const projects = useAppStore((s) => s.projects)
  const workspaces = useAppStore((s) => s.workspaces)
  const workspace = workspaces.find((ws) => ws.id === workspaceId)
  const project = workspace ? projects.find((p) => p.id === workspace.projectId) : undefined
  const repoPath = project?.repoPath ?? ''
  const chatViewRef = useRef<HTMLDivElement | null>(null)
  useConductorChatTypographyScope(chatViewRef)

  const agentSessionId = tab.agentSessionId ?? null
  const [draftProvider, setDraftProvider] = useState<AgentProvider>(() => {
    return normalizeConductorDefaultProvider(conductorDefaultProviderSetting)
  })
  const [draftModel, setDraftModel] = useState<string>(() => {
    const provider = normalizeConductorDefaultProvider(conductorDefaultProviderSetting)
    return resolveConductorDefaultSelection(
      provider,
      normalizeConductorDefaultModel(conductorDefaultModelSetting),
      conductorDefaultThinkingLevelSetting,
    ).model
  })
  const [draftThinkingLevel, setDraftThinkingLevel] = useState<ThinkingLevel>(() => {
    const provider = normalizeConductorDefaultProvider(conductorDefaultProviderSetting)
    return resolveConductorDefaultSelection(
      provider,
      normalizeConductorDefaultModel(conductorDefaultModelSetting),
      conductorDefaultThinkingLevelSetting,
    ).thinkingLevel
  })
  const [draftPlan, setDraftPlan] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<ConductorAuthStatus | null>(null)
  const [cursorLoginStarted, setCursorLoginStarted] = useState(false)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [forking, setForking] = useState(false)
  const [approvingPlan, setApprovingPlan] = useState(false)
  const [mcpStatusOpen, setMcpStatusOpen] = useState(false)
  const [mcpBannerOpen, setMcpBannerOpen] = useState(false)
  const [mcpTerminalOpen, setMcpTerminalOpen] = useState(false)
  const [mcpTerminalPtyId, setMcpTerminalPtyId] = useState<string | null>(null)
  const composerRef = useRef<ChatComposerHandle | null>(null)
  const timelineRef = useRef<ChatTimelineHandle | null>(null)

  useEffect(() => {
    void syncConductorAuthKeys(
      conductorCursorApiKey,
      conductorOpenaiApiKey,
      conductorCodexWebSocketsSetting,
    )
    void fetchConductorAuthStatus(true).then(setAuthStatus)
  }, [conductorCursorApiKey, conductorOpenaiApiKey, conductorCodexWebSocketsSetting])

  useEffect(() => {
    if (!cursorLoginStarted) return
    const timer = setInterval(() => {
      void fetchConductorAuthStatus(true).then(setAuthStatus)
    }, 2000)
    return () => clearInterval(timer)
  }, [cursorLoginStarted])

  const controller = useConductorSession(agentSessionId)
  const cancelRun = controller.cancel

  const provider = controller.state?.provider ?? draftProvider
  const model = controller.state?.model ?? draftModel
  const thinkingLevel = normalizeThinkingLevel(controller.state?.thinkingLevel ?? draftThinkingLevel)
  const plan = controller.state?.plan ?? draftPlan
  const running = controller.state?.status === 'running'
  const awaitingUser = controller.state?.runPhase === 'awaitingUser'
  const blockingQuestion = controller.state?.blockingQuestion ?? null
  const latestPlanApprovalMessageId = useMemo(
    () => (plan && !running ? getLatestPlanApprovalMessageId(controller.transcript) : null),
    [plan, running, controller.transcript],
  )

  useEffect(() => {
    if (running) {
      setRunStartedAt((prev) => prev ?? Date.now())
    } else {
      setRunStartedAt(null)
    }
  }, [running])

  useEffect(() => {
    if (!active || !running) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target
      if (!(target instanceof Element)) return
      if (target.closest('[role="listbox"], [role="dialog"]')) return
      if (target.closest('[data-conductor-context-panel]')) return
      e.preventDefault()
      void cancelRun()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, running, cancelRun])

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
    const trimmed = message.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        const nestedErrorMessage =
          parsed.error &&
          typeof parsed.error === 'object' &&
          typeof (parsed.error as { message?: unknown }).message === 'string'
            ? (parsed.error as { message: string }).message
            : undefined
        const detail =
          (typeof parsed.message === 'string' && parsed.message) ||
          (typeof parsed.error === 'string' && parsed.error) ||
          (typeof parsed.detail === 'string' && parsed.detail) ||
          nestedErrorMessage
        if (detail) return detail
      } catch {
        // keep raw message
      }
    }
    const apiMatch = message.match(/"message"\s*:\s*"([^"]+)"/)
    if (apiMatch?.[1]) return apiMatch[1]
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

  const handleSubmit = async (
    text: string,
    deliverAs?: QueuedAgentMessageMode,
    attachments?: readonly ConductorComposerAttachment[],
  ) => {
    setSubmitError(null)
    try {
      let id = agentSessionId
      if (!id) {
        id = await createSession(draftProvider, draftModel, text.slice(0, 48))
      }
      if (id) await window.api.agentChat.submit(id, text, deliverAs, attachments)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSubmitError(formatChatError(message))
    }
  }

  const dispatchHarnessCommand = useCallback(
    async (text: string) => {
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
    },
    [
      agentSessionId,
      draftProvider,
      draftModel,
      plan,
      thinkingLevel,
      workspaceId,
      worktreePath,
      tab.id,
      setConductorTabSessionBinding,
    ],
  )

  const closeMcpTerminal = useCallback(() => {
    if (mcpTerminalPtyId) {
      window.api.pty.destroy(mcpTerminalPtyId)
    }
    setMcpTerminalOpen(false)
    setMcpBannerOpen(false)
    setMcpTerminalPtyId(null)
    composerRef.current?.focus()
  }, [mcpTerminalPtyId])

  const openMcpTerminal = useCallback(async () => {
    if (!worktreePath || mcpTerminalPtyId) {
      setMcpBannerOpen(false)
      setMcpTerminalOpen(true)
      return
    }
    try {
      const ptyId = await window.api.pty.create(worktreePath)
      setMcpTerminalPtyId(ptyId)
      setMcpBannerOpen(false)
      setMcpTerminalOpen(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSubmitError(formatChatError(message))
    }
  }, [worktreePath, mcpTerminalPtyId])

  useEffect(() => {
    return () => {
      if (mcpTerminalPtyId) {
        window.api.pty.destroy(mcpTerminalPtyId)
      }
    }
  }, [mcpTerminalPtyId])

  const handleRestartSession = useCallback(async () => {
    setSubmitError(null)
    try {
      if (running) {
        await cancelRun()
      }
      if (agentSessionId) {
        await window.api.agentChat.deleteSession(agentSessionId)
      }
      useAppStore.setState((state) => ({
        tabs: state.tabs.map((entry) =>
          entry.id === tab.id && entry.type === 'conductor'
            ? { ...entry, agentSessionId: undefined }
            : entry,
        ),
      }))
      composerRef.current?.focus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSubmitError(formatChatError(message))
    }
  }, [running, cancelRun, agentSessionId, tab.id])

  const handleReplaceQueue = (messages: readonly QueuedAgentMessage[]) => {
    if (!agentSessionId) return
    void window.api.agentChat.replaceQueue(agentSessionId, messages).catch(() => {})
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

  const handleSlashAction = useCallback(
    (command: ConductorSlashCommand) => {
      switch (command.id) {
        case 'host:clear':
          removeTab(tab.id)
          createConductorTabForActiveWorkspace()
          return
        case 'host:restart':
          void handleRestartSession()
          return
        case 'host:mcp-status':
          setMcpStatusOpen(true)
          return
        case 'host:mcp':
          setMcpBannerOpen(true)
          return
        case 'host:plan':
          handleSetPlan(true)
          composerRef.current?.focus()
          return
        case 'host:fast':
          if (hasFastVariant(model, provider)) {
            handleToggleFast(true)
          }
          composerRef.current?.focus()
          return
        case 'host:compact':
          void dispatchHarnessCommand('/compact')
          return
        default:
          if (command.kind === 'skill') {
            void dispatchHarnessCommand(command.command)
          }
      }
    },
    [
      tab.id,
      removeTab,
      createConductorTabForActiveWorkspace,
      handleRestartSession,
      handleSetPlan,
      handleToggleFast,
      model,
      provider,
      dispatchHarnessCommand,
    ],
  )

  const handleNamePromptConfirm = useCallback(
    (command: ConductorSlashCommand, value: string) => {
      void dispatchHarnessCommand(`${command.command} ${value}`)
      composerRef.current?.focus()
    },
    [dispatchHarnessCommand],
  )

  const handlePersonalitySelect = useCallback(
    (value: string) => {
      void window.api.codex
        .setPersonality(value as 'pragmatic' | 'friendly' | 'none')
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          setSubmitError(formatChatError(message))
        })
      composerRef.current?.focus()
    },
    [formatChatError],
  )

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

  const handleApprovePlan = useCallback(
    async (messageId: string) => {
      if (!agentSessionId || running || approvingPlan) return
      if (messageId !== latestPlanApprovalMessageId) return
      setSubmitError(null)
      setApprovingPlan(true)
      try {
        handleSetPlan(false)
        await window.api.agentChat.setPlan(agentSessionId, false)
        await window.api.agentChat.submit(agentSessionId, APPROVE_PLAN_MESSAGE)
        composerRef.current?.focus()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setSubmitError(formatChatError(message))
      } finally {
        setApprovingPlan(false)
      }
    },
    [agentSessionId, running, approvingPlan, latestPlanApprovalMessageId, formatChatError],
  )

  useEffect(() => {
    if (!active || !latestPlanApprovalMessageId || running || approvingPlan) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !e.metaKey || !e.shiftKey || e.defaultPrevented) return
      const target = e.target
      if (target instanceof Element) {
        if (target.closest('[role="listbox"], [role="dialog"]')) return
        if (target.closest('[data-conductor-context-panel]')) return
      }
      e.preventDefault()
      void handleApprovePlan(latestPlanApprovalMessageId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, latestPlanApprovalMessageId, running, approvingPlan, handleApprovePlan])

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
    <div
      ref={chatViewRef}
      className={styles.chatView}
      data-active={active}
      data-testid="conductor-chat-view"
    >
      <SharedFileIconDefs appearanceThemeId={appearanceThemeId} />
      <ChatTimeline
        ref={timelineRef}
        transcript={controller.transcript}
        running={running}
        runStartedAt={runStartedAt}
        planActive={plan}
        onSelectHistoryTurn={handleSelectHistoryTurn}
        onFork={handleForkFromMessage}
        forkDisabled={forking}
        onApprovePlan={handleApprovePlan}
        approveDisabled={running || approvingPlan}
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
      {blockingQuestion ? (
        <ConductorAskQuestionModal
          question={blockingQuestion}
          onSubmit={(details) => {
            controller.respondBlockingQuestion({ requestId: blockingQuestion.requestId, details })
          }}
          onCancel={() => {
            void controller.cancel()
          }}
        />
      ) : null}
      <div className={styles.composerStackPanels}>
        {mcpStatusOpen ? (
          <ConductorMcpStatusPanel
            provider={provider}
            workspacePath={worktreePath}
            onClose={() => setMcpStatusOpen(false)}
          />
        ) : null}
        {mcpTerminalOpen && mcpTerminalPtyId ? (
          <ConductorEmbeddedTerminal ptyId={mcpTerminalPtyId} onDone={closeMcpTerminal} />
        ) : mcpBannerOpen ? (
          <ConductorMcpTerminalBanner
            onOpenTerminal={() => void openMcpTerminal()}
            onClose={() => setMcpBannerOpen(false)}
          />
        ) : null}
      </div>
      <ChatComposer
        provider={provider}
        model={model}
        thinkingLevel={thinkingLevel}
        plan={plan}
        running={running}
        disabled={!worktreePath || awaitingUser}
        queuedMessages={controller.state?.queuedMessages ?? []}
        onSubmit={handleSubmit}
        onCancel={controller.cancel}
        onReplaceQueue={handleReplaceQueue}
        onSetModel={handleSelectModel}
        onSetThinkingLevel={handleSetThinkingLevel}
        onToggleFast={handleToggleFast}
        onSetPlan={handleSetPlan}
        onHistoryUp={() => timelineRef.current?.openHistory()}
        composerRef={composerRef}
        sessionId={agentSessionId}
        workspacePath={worktreePath}
        repoPath={repoPath}
        onSlashAction={handleSlashAction}
        onPersonalitySelect={handlePersonalitySelect}
        onNamePromptConfirm={handleNamePromptConfirm}
      />
    </div>
  )
}
