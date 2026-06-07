import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquareMore, X } from 'lucide-react'
import type {
  AgentProvider,
  QueuedAgentMessage,
  QueuedAgentMessageMode,
} from '../../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../../shared/conductor-attachments'
import type { ConductorSlashCommand } from '../../../shared/conductor-composer-commands'
import type { ThinkingLevel } from '../../../shared/conductor-thinking'
import { normalizeThinkingLevel } from '../../../shared/conductor-thinking'
import {
  hasFastVariant,
  normalizeConductorDefaultModel,
  normalizeConductorDefaultProvider,
  resolveConductorDefaultSelection,
  setModelFast,
  toConductorDraftSelection,
} from '../../../shared/conductor-model-utils'
import { useAppStore } from '../../store/app-store'
import { findSideForPanel } from '../../store/side-panels'
import { SharedFileIconDefs } from '../../utils/file-presentation'
import { useConductorSession } from '../Conductor/use-agent-chat'
import { useConductorChatTypographyScope } from '../Conductor/useConductorChatTypographyScope'
import { ChatTimeline, type ChatTimelineHandle } from '../Conductor/chat/ChatTimeline'
import { ChatComposer, type ChatComposerHandle } from '../Conductor/chat/ChatComposer'
import {
  bindSideChatSession,
  clearSideChatBinding,
  latestSideChatBinding,
  latestSideChatSeed,
  subscribeSideChatSeeds,
  type SideChatSeed,
} from './side-chat-events'
import conductorStyles from '../Conductor/Conductor.module.css'
import styles from './SideChatPanel.module.css'
import '../../pi-gui/pi-gui-thread.css'
import '../../pi-gui/pi-gui-constellagent-bridge.css'

function formatChatError(message: string): string {
  const trimmed = message.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const detail =
        (typeof parsed.message === 'string' && parsed.message) ||
        (typeof parsed.error === 'string' && parsed.error) ||
        (typeof parsed.detail === 'string' && parsed.detail)
      if (detail) return detail
    } catch {
      return message
    }
  }
  return message
}

function compactInstructionsFromComposer(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/compact')) return undefined
  const rest = trimmed.slice('/compact'.length).trim()
  return rest || undefined
}

function sideChatTitle(seed: SideChatSeed | null, fallback: string): string {
  const source = seed?.sourceTitle?.trim()
  return source ? `Side · ${source.slice(0, 42)}` : fallback
}

export function SideChatPanel({ workspaceId, worktreePath }: { workspaceId: string; worktreePath: string }) {
  const projects = useAppStore((s) => s.projects)
  const workspaces = useAppStore((s) => s.workspaces)
  const sidePanels = useAppStore((s) => s.sidePanels)
  const setSidePanelOpen = useAppStore((s) => s.setSidePanelOpen)
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const conductorDefaultProviderSetting = useAppStore((s) => s.settings.conductorDefaultProvider)
  const conductorDefaultModelSetting = useAppStore((s) => s.settings.conductorDefaultModel)
  const conductorDefaultThinkingLevelSetting = useAppStore(
    (s) => s.settings.conductorDefaultThinkingLevel,
  )
  const workspace = workspaces.find((entry) => entry.id === workspaceId)
  const project = workspace ? projects.find((entry) => entry.id === workspace.projectId) : undefined
  const repoPath = project?.repoPath ?? ''
  const defaultProvider = normalizeConductorDefaultProvider(conductorDefaultProviderSetting)
  const defaultSelection = resolveConductorDefaultSelection(
    defaultProvider,
    normalizeConductorDefaultModel(conductorDefaultModelSetting),
    conductorDefaultThinkingLevelSetting,
  )
  const [sessionId, setSessionId] = useState<string | null>(() => {
    return latestSideChatBinding(workspaceId)?.sessionId ?? null
  })
  const [draftProvider, setDraftProvider] = useState<AgentProvider>(defaultProvider)
  const [draftModel, setDraftModel] = useState(defaultSelection.model)
  const [draftThinkingLevel, setDraftThinkingLevel] = useState<ThinkingLevel>(defaultSelection.thinkingLevel)
  const [draftPlan, setDraftPlan] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const composerRef = useRef<ChatComposerHandle | null>(null)
  const timelineRef = useRef<ChatTimelineHandle | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const initializedSeedRef = useRef<number | null>(null)
  useConductorChatTypographyScope(panelRef)

  const controller = useConductorSession(sessionId)
  const provider = controller.state?.provider ?? draftProvider
  const model = controller.state?.model ?? draftModel
  const thinkingLevel = normalizeThinkingLevel(controller.state?.thinkingLevel ?? draftThinkingLevel)
  const plan = controller.state?.plan ?? draftPlan
  const running = controller.state?.status === 'running'
  const awaitingUser = controller.state?.runPhase === 'awaitingUser'

  useEffect(() => {
    if (running) {
      setRunStartedAt((prev) => prev ?? Date.now())
    } else {
      setRunStartedAt(null)
    }
  }, [running])

  useEffect(() => {
    const binding = latestSideChatBinding(workspaceId)
    setSessionId(binding?.sessionId ?? null)
  }, [workspaceId])

  const createSession = useCallback(
    async (
      nextProvider: AgentProvider,
      nextModel: string,
      title: string,
      nextThinkingLevel: ThinkingLevel,
      nextPlan: boolean,
    ): Promise<string> => {
      const created = await window.api.agentChat.createSession({
        workspaceId,
        workspacePath: worktreePath,
        provider: nextProvider,
        model: nextModel,
        title,
        plan: nextPlan,
        thinkingLevel: nextThinkingLevel,
      })
      bindSideChatSession({
        workspaceId,
        sessionId: created.sessionId,
        sourceSessionId: null,
        forkMessageId: null,
      })
      setSessionId(created.sessionId)
      return created.sessionId
    },
    [workspaceId, worktreePath],
  )

  const initializeFromSeed = useCallback(
    async (seed: SideChatSeed) => {
      if (seed.workspaceId !== workspaceId || initializedSeedRef.current === seed.createdAt) return
      initializedSeedRef.current = seed.createdAt
      setDraftProvider(seed.provider)
      setDraftModel(seed.model)
      setDraftThinkingLevel(seed.thinkingLevel)
      setDraftPlan(seed.plan)
      setSubmitError(null)
      setInitializing(true)
      try {
        const existing = latestSideChatBinding(workspaceId)
        clearSideChatBinding(workspaceId)
        setSessionId(null)
        if (existing?.sessionId) {
          void window.api.agentChat.deleteSession(existing.sessionId).catch(() => {})
        }
        if (seed.sourceSessionId && seed.forkMessageId) {
          const created = await window.api.agentChat.forkSession({
            sourceSessionId: seed.sourceSessionId,
            upToMessageId: seed.forkMessageId,
            title: sideChatTitle(seed, 'Side chat'),
          })
          bindSideChatSession({
            workspaceId,
            sessionId: created.sessionId,
            sourceSessionId: seed.sourceSessionId,
            forkMessageId: seed.forkMessageId,
          })
          setSessionId(created.sessionId)
        } else {
          await createSession(seed.provider, seed.model, 'Side chat', seed.thinkingLevel, seed.plan)
        }
        if (seed.draftText.trim()) {
          requestAnimationFrame(() => composerRef.current?.setText(seed.draftText.trim()))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setSubmitError(formatChatError(message))
      } finally {
        setInitializing(false)
      }
    },
    [createSession, workspaceId],
  )

  useEffect(() => {
    const seed = latestSideChatSeed(workspaceId)
    if (seed) void initializeFromSeed(seed)
    return subscribeSideChatSeeds((nextSeed) => {
      void initializeFromSeed(nextSeed)
    })
  }, [initializeFromSeed, workspaceId])

  const ensureSession = useCallback(
    async (titleSeed: string): Promise<string | null> => {
      if (sessionId) return sessionId
      try {
        return await createSession(
          draftProvider,
          draftModel,
          titleSeed.trim().slice(0, 48) || 'Side chat',
          draftThinkingLevel,
          draftPlan,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setSubmitError(formatChatError(message))
        return null
      }
    },
    [createSession, draftModel, draftPlan, draftProvider, draftThinkingLevel, sessionId],
  )

  const handleSubmit = useCallback(
    async (
      text: string,
      deliverAs?: QueuedAgentMessageMode,
      attachments?: readonly ConductorComposerAttachment[],
    ) => {
      setSubmitError(null)
      const id = await ensureSession(text)
      if (!id) return
      try {
        await window.api.agentChat.submit(id, text, deliverAs, attachments)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setSubmitError(formatChatError(message))
      }
    },
    [ensureSession],
  )

  const handleCompactSession = useCallback(
    async (customInstructions?: string) => {
      setSubmitError(null)
      const id = await ensureSession('Compacted side chat')
      if (!id) return
      try {
        await window.api.agentChat.compactSession(id, customInstructions)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setSubmitError(formatChatError(message))
      } finally {
        composerRef.current?.focus()
      }
    },
    [ensureSession],
  )

  const handleReplaceQueue = useCallback(
    (messages: readonly QueuedAgentMessage[]) => {
      if (!sessionId) return
      void window.api.agentChat.replaceQueue(sessionId, messages).catch(() => {})
    },
    [sessionId],
  )

  const handleSelectModel = useCallback(
    (nextProvider: AgentProvider, nextModel: string) => {
      const { model: storedModel, thinkingLevel: level } = toConductorDraftSelection(nextModel)
      if (controller.state) {
        if (controller.state.provider === nextProvider) {
          controller.setModel(storedModel)
          controller.setThinkingLevel(level)
        } else {
          void createSession(nextProvider, storedModel, 'Side chat', level, plan)
        }
      } else {
        setDraftProvider(nextProvider)
        setDraftModel(storedModel)
        setDraftThinkingLevel(level)
      }
    },
    [controller, createSession, plan],
  )

  const handleSetThinkingLevel = useCallback(
    (level: ThinkingLevel) => {
      setDraftThinkingLevel(level)
      if (sessionId) controller.setThinkingLevel(level)
    },
    [controller, sessionId],
  )

  const handleSetPlan = useCallback(
    (nextPlan: boolean) => {
      setDraftPlan(nextPlan)
      setSubmitError(null)
      if (sessionId) controller.setPlan(nextPlan)
    },
    [controller, sessionId],
  )

  const handleToggleFast = useCallback(
    (fast: boolean) => {
      const nextModel = setModelFast(model, fast)
      setDraftModel(nextModel)
      setSubmitError(null)
      if (sessionId) controller.setModel(nextModel)
    },
    [controller, model, sessionId],
  )

  const clearSession = useCallback(async () => {
    setSubmitError(null)
    const currentSessionId = sessionId
    clearSideChatBinding(workspaceId)
    setSessionId(null)
    if (!currentSessionId) {
      composerRef.current?.focus()
      return
    }
    try {
      await window.api.agentChat.deleteSession(currentSessionId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSubmitError(formatChatError(message))
    } finally {
      composerRef.current?.focus()
    }
  }, [sessionId, workspaceId])

  const closeSideChat = useCallback(() => {
    void clearSession()
    setSidePanelOpen(findSideForPanel(sidePanels, 'sideChat'), false)
  }, [clearSession, setSidePanelOpen, sidePanels])

  const handleSlashAction = useCallback(
    (command: ConductorSlashCommand, context: { composerText: string }) => {
      switch (command.id) {
        case 'host:clear':
        case 'host:restart':
          void clearSession()
          return
        case 'host:mcp':
        case 'host:mcp-status':
          setSubmitError(`${command.command} is available from the main chat.`)
          composerRef.current?.focus()
          return
        case 'host:plan':
          handleSetPlan(true)
          composerRef.current?.focus()
          return
        case 'host:fast':
          if (hasFastVariant(model, provider)) handleToggleFast(true)
          composerRef.current?.focus()
          return
        case 'host:compact':
          void handleCompactSession(compactInstructionsFromComposer(context.composerText))
          return
        case 'host:side':
          composerRef.current?.focus()
          return
        default:
          if (command.kind === 'skill') void handleSubmit(command.command)
      }
    },
    [clearSession, handleCompactSession, handleSetPlan, handleSubmit, handleToggleFast, model, provider],
  )

  const handleNamePromptConfirm = useCallback(
    (command: ConductorSlashCommand, value: string) => {
      void handleSubmit(`${command.command} ${value}`)
      composerRef.current?.focus()
    },
    [handleSubmit],
  )

  const handlePersonalitySelect = useCallback((value: string) => {
    void window.api.codex.setPersonality(value as 'pragmatic' | 'friendly' | 'none').catch(() => {})
    composerRef.current?.focus()
  }, [])

  const subtitle = controller.state?.title ?? (initializing ? 'Preparing context' : 'Private side chat')
  const status = running ? 'Running' : initializing ? 'Forking' : sessionId ? 'Ready' : 'New'

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <MessageSquareMore size={15} strokeWidth={2} />
        <div className={styles.title}>
          <div className={styles.titleText}>Side Chat</div>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
        <div className={styles.status}>{status}</div>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Close side chat"
          title="Close side chat"
          onClick={closeSideChat}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <div ref={panelRef} className={styles.chatInset}>
        <div className={conductorStyles.chatView} data-active="true">
          <SharedFileIconDefs appearanceThemeId={appearanceThemeId} />
          <ChatTimeline
            ref={timelineRef}
            transcript={controller.transcript}
            running={running}
            runStartedAt={runStartedAt}
            planActive={plan}
            onSelectHistoryTurn={(messageId, refillComposer) => {
              timelineRef.current?.scrollToMessage(messageId)
              if (refillComposer) {
                const item = controller.transcript.find(
                  (entry) => entry.kind === 'message' && entry.id === messageId,
                )
                if (item?.kind === 'message' && item.role === 'user') composerRef.current?.setText(item.text)
              }
            }}
            provider={provider}
            model={model}
            thinkingLevel={thinkingLevel}
          />
          {submitError || controller.state?.error ? (
            <div className={styles.error} role="alert">
              <span>{submitError ?? controller.state?.error}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setSubmitError(null)}>
                ×
              </button>
            </div>
          ) : null}
          <ChatComposer
            provider={provider}
            model={model}
            thinkingLevel={thinkingLevel}
            plan={plan}
            running={running}
            disabled={!worktreePath || awaitingUser || initializing}
            queuedMessages={controller.state?.queuedMessages ?? []}
            transcript={controller.transcript}
            onSubmit={handleSubmit}
            onCancel={controller.cancel}
            onReplaceQueue={handleReplaceQueue}
            onSetModel={handleSelectModel}
            onSetThinkingLevel={handleSetThinkingLevel}
            onToggleFast={handleToggleFast}
            onSetPlan={handleSetPlan}
            onHistoryUp={() => timelineRef.current?.openHistory()}
            composerRef={composerRef}
            sessionId={sessionId}
            workspacePath={worktreePath}
            repoPath={repoPath}
            onSlashAction={handleSlashAction}
            onPersonalitySelect={handlePersonalitySelect}
            onNamePromptConfirm={handleNamePromptConfirm}
          />
        </div>
      </div>
    </div>
  )
}
