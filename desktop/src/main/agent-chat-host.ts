import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { sessionKey } from '@pi-gui/pi-sdk-driver'
import type {
  HostUiResponse,
  SessionDriverEvent,
  SessionRef,
  SessionSnapshot,
} from '@pi-gui/session-driver'
import { IPC } from '../shared/ipc-channels'
import type { TranscriptMessage } from '../shared/pi/pi-desktop-state'
import {
  appendAssistantDelta,
  appendUserMessage,
  applyTimelineEvent,
  type TimelineRuntimeState,
} from './pi-timeline'
import { makeToolItem } from './pi-app-store-utils'
import { AgentChatStore } from './agent-chat-store'
import { GitService } from './git-service'
import { evToolFinished, type AgentDriver } from './agents/agent-driver'
import { CodexDriver } from './agents/codex-driver'
import { CursorDriver } from './agents/cursor-driver'
import { PiConductorDriver } from './agents/pi-conductor-driver'
import type { AgentSdkHooks } from './agents/agent-sdk-hooks'
import {
  cloneTranscriptWithNewIds,
  compactTranscriptForAgentContext,
  sliceTranscriptForFork,
} from '../shared/conductor-transcript-utils'
import {
  normalizeConductorDefaultProvider,
  thinkingLevelFromModel,
  parseModelEffort,
} from '../shared/conductor-model-utils'
import { normalizeThinkingLevel } from '../shared/conductor-thinking'
import {
  cloneConductorImageAttachments,
  conductorPromptText,
  hasConductorMessageInput,
  type ConductorComposerAttachment,
} from '../shared/conductor-attachments'
import {
  buildContextWindowData,
  estimateTokensFromTranscript,
} from '../shared/context-window-utils'
import { detectCanvasIntent } from '../shared/json-canvas-schema'
import {
  isConductorGeneratedImageOutput,
  isGeneratedImageToolCall,
  hasRenderableGeneratedImageOutput,
  looksLikeGeneratedImageCompletionText,
  turnTranscriptText,
  type ConductorGeneratedImageOutput,
  userRequestedGeneratedImages,
} from '../shared/conductor-generated-images'
import { isPlanApprovalMessage } from '../shared/plan-approval'
import {
  loadGeneratedImagesForTurn,
  resolveConductorGeneratedImagesWithFiles,
} from './conductor-generated-image-files'
import type { ContextWindowData } from '../shared/context-window-types'
import type {
  AgentChatSessionState,
  AgentChatStatus,
  AgentProvider,
  CreateAgentChatSessionInput,
  ForkAgentChatSessionInput,
  QueuedAgentMessage,
  QueuedAgentMessageMode,
} from '../shared/agent-chat-types'
import type { ModelPreset } from '../shared/plan-build-command'
import type {
  ConductorAskQuestionPrompt,
  ConductorBlockingQuestionResponse,
} from '../shared/conductor-ask-question-types'
import {
  enqueueQueuedMessage,
  findSteerMessageIndex,
} from './agent-chat-queue'
import { getConductorQuestionBridge } from './agents/conductor-question-bridge'
import { appendAssistantStreamDelta } from './agents/agent-driver'
import { logMainPerfEvent, measureMainAsync } from './perf'
import { mobileDebugLog, shouldSampleMobileDelta } from './mobile-debug-log'

export type { AgentChatSessionState, CreateAgentChatSessionInput }

interface RuntimeSession {
  state: AgentChatSessionState
  abort?: AbortController
}

interface TurnTelemetry {
  readonly submittedAt: number
  runningAt?: number
  firstDriverEventAt?: number
  firstAssistantDeltaAt?: number
  driverEventCount: number
  assistantDeltaCount: number
  transcriptFlushCount: number
}

export type AgentChatBroadcastListener = (channel: string, payload: unknown) => void

export interface AgentChatHostOptions {
  readonly sdkHooks?: AgentSdkHooks
}

export class AgentChatHost {
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly questionBridge = getConductorQuestionBridge()
  private readonly transcriptCache = new Map<string, TranscriptMessage[]>()
  private readonly broadcastListeners = new Set<AgentChatBroadcastListener>()
  private readonly timelineState: TimelineRuntimeState = {
    runMetricsBySession: new Map(),
    runningSinceBySession: new Map(),
    activeAssistantMessageBySession: new Map(),
    activeWorkingActivityBySession: new Map(),
    userRequestedGeneratedImagesBySession: new Map(),
  }
  private readonly store = new AgentChatStore()
  private readonly drivers: Record<AgentProvider, AgentDriver>
  /** Coalesces high-frequency transcript broadcasts during streaming (~25fps). */
  private readonly pendingTranscriptFlush = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly turnTelemetry = new Map<string, TurnTelemetry>()
  /** Tracks assistant text already appended/broadcast for word-boundary delta normalization. */
  private readonly emittedAssistantTextBySession = new Map<string, string>()
  /** Samples assistant delta logs per session when mobile debug is enabled. */
  private readonly assistantDeltaDebugSequenceBySession = new Map<string, number>()
  private static readonly TRANSCRIPT_FLUSH_MS = 40

  constructor(options: AgentChatHostOptions = {}) {
    this.drivers = {
      codex: new CodexDriver(options.sdkHooks),
      cursor: new CursorDriver(options.sdkHooks),
      pi: new PiConductorDriver(),
    }
    this.questionBridge.setHostNotifier((question) => {
      this.setBlockingQuestion(question.sessionId, question)
    })
  }

  async createSession(input: CreateAgentChatSessionInput): Promise<AgentChatSessionState> {
    const nowIso = new Date().toISOString()
    const state: AgentChatSessionState = {
      sessionId: randomUUID(),
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      title: input.title?.trim() || 'New chat',
      provider: input.provider,
      model: input.model,
      thinkingLevel: input.thinkingLevel ?? thinkingLevelFromModel(input.model),
      plan: input.plan ?? false,
      canvas: input.canvas ?? false,
      status: 'idle',
      runPhase: 'idle',
      blockingQuestion: null,
      providerSession: undefined,
      piExtensionUi: null,
      queuedMessages: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    this.sessions.set(state.sessionId, { state })
    this.transcriptCache.set(sessionKey(this.refOf(state)), [])
    await this.store.upsertSession(state)
    this.broadcastState(state)
    return state
  }

  /**
   * Branch chat at a message: copies full transcript through fork point into a new
   * session (new ids). SDK driver state is not shared — UI transcript only.
   */
  async forkSession(input: ForkAgentChatSessionInput): Promise<AgentChatSessionState> {
    const source = await this.getSession(input.sourceSessionId)
    if (!source) {
      throw new Error('Source session not found')
    }
    const slice = sliceTranscriptForFork(source.transcript, input.upToMessageId)
    if (slice.length === 0) {
      throw new Error('Nothing to fork at this message')
    }
    const forkedTranscript = cloneTranscriptWithNewIds(slice)
    const title =
      input.title?.trim() ||
      `Fork · ${source.state.title.slice(0, 40)}${source.state.title.length > 40 ? '…' : ''}`

    const created = await this.createSession({
      workspaceId: source.state.workspaceId,
      workspacePath: source.state.workspacePath,
      provider: source.state.provider,
      model: source.state.model,
      plan: source.state.plan,
      canvas: source.state.canvas,
      thinkingLevel: source.state.thinkingLevel,
      title,
    })

    const key = sessionKey(this.refOf(created))
    this.transcriptCache.set(key, forkedTranscript)
    await this.store.saveTranscript(created.sessionId, forkedTranscript)
    this.flushTranscript(created)
    return created
  }

  async listSessions(workspaceId: string): Promise<AgentChatSessionState[]> {
    const stored = await this.store.listSessions(workspaceId)
    // Prefer in-memory state (fresher status) when present.
    return stored.map((s) => this.sessions.get(s.sessionId)?.state ?? this.normalizeStoredSession({ ...s }))
  }

  async getSession(
    sessionId: string,
  ): Promise<{ state: AgentChatSessionState; transcript: TranscriptMessage[] } | null> {
    const state = await this.resolveState(sessionId)
    if (!state) return null
    const key = sessionKey(this.refOf(state))
    let transcript = this.transcriptCache.get(key)
    if (!transcript) {
      transcript = await this.store.loadTranscript(sessionId)
      this.transcriptCache.set(key, transcript)
    }
    return { state, transcript }
  }

  async getContextUsage(sessionId: string): Promise<ContextWindowData | null> {
    const state = await this.resolveState(sessionId)
    if (!state) return null
    const key = sessionKey(this.refOf(state))
    let transcript = this.transcriptCache.get(key)
    if (!transcript) {
      transcript = await this.store.loadTranscript(sessionId)
      this.transcriptCache.set(key, transcript)
    }
    return this.buildContextUsage(state, transcript)
  }

  private buildContextUsage(
    state: AgentChatSessionState,
    transcript: readonly TranscriptMessage[],
  ): ContextWindowData {
    const estimated = estimateTokensFromTranscript(transcript)
    const sdkUsed = this.drivers[state.provider]?.getContextUsage?.(state.sessionId) ?? null
    const usedTokens = sdkUsed != null ? Math.max(sdkUsed, estimated) : estimated
    return buildContextWindowData({
      usedTokens,
      model: state.model,
      sessionId: state.sessionId,
    })
  }

  private broadcastContextUsage(state: AgentChatSessionState | undefined): void {
    if (!state) return
    const transcript = this.transcriptCache.get(sessionKey(this.refOf(state))) ?? []
    const usage = this.buildContextUsage(state, transcript)
    this.send(IPC.AGENT_CHAT_CONTEXT_CHANGED, { sessionId: state.sessionId, usage })
  }

  async submit(
    sessionId: string,
    text: string,
    deliverAs?: QueuedAgentMessageMode,
    attachments: readonly ConductorComposerAttachment[] = [],
  ): Promise<void> {
    const trimmed = text.trim()
    const normalizedAttachments = cloneConductorImageAttachments(attachments)
    if (!hasConductorMessageInput(trimmed, normalizedAttachments)) return

    const live = this.sessions.get(sessionId)
    const state = live?.state ?? (await this.rehydrate(sessionId))
    if (!state) return

    const isRunning = state.status === 'running'
    if (state.runPhase === 'awaitingUser') return
    if (isRunning) {
      const mode = deliverAs ?? 'followUp'
      this.setQueuedMessages(
        sessionId,
        enqueueQueuedMessage(state.queuedMessages, trimmed, mode, undefined, normalizedAttachments),
      )
      if (mode === 'steer') {
        await this.cancel(sessionId)
      }
      return
    }

    await this.startTurn(sessionId, trimmed, normalizedAttachments)
  }

  async compactSession(sessionId: string, customInstructions?: string): Promise<void> {
    const live = this.sessions.get(sessionId)
    let state = live?.state ?? (await this.rehydrate(sessionId))
    if (!state) return
    if (state.status === 'running' || state.runPhase === 'awaitingUser') {
      throw new Error('Cannot compact while a run is in progress.')
    }

    const driver = this.drivers[state.provider]
    if (!driver) {
      throw new Error(`Unsupported agent provider: ${String(state.provider)}`)
    }

    const ref = this.refOf(state)
    const key = sessionKey(ref)
    const previousTranscript = this.transcriptCache.get(key) ?? (await this.store.loadTranscript(sessionId))
    const compactedTranscript = compactTranscriptForAgentContext(previousTranscript, customInstructions)

    this.transcriptCache.set(key, compactedTranscript)
    this.emittedAssistantTextBySession.delete(key)
    this.assistantDeltaDebugSequenceBySession.delete(key)
    this.timelineState.activeAssistantMessageBySession.delete(key)
    this.timelineState.activeWorkingActivityBySession.delete(key)
    this.timelineState.runningSinceBySession.delete(key)
    this.timelineState.runMetricsBySession.delete(key)
    this.update(sessionId, { status: 'running', runPhase: 'running', blockingQuestion: null, error: undefined })
    state = this.currentState(sessionId) ?? state

    try {
      await (driver.compactSession?.({
        sessionRef: ref,
        workspacePath: state.workspacePath,
        model: state.model,
        thinkingLevel: state.thinkingLevel,
        plan: state.plan,
        canvas: state.canvas,
        customInstructions: customInstructions?.trim() || undefined,
        previousTranscript,
      }) ?? Promise.resolve(driver.closeSession(sessionId)))
      this.update(sessionId, {
        status: 'idle',
        runPhase: 'idle',
        blockingQuestion: null,
        providerSession: undefined,
        piExtensionUi: null,
        error: undefined,
      })
      const next = this.currentState(sessionId)
      if (next) {
        await this.persist(next)
        this.flushTranscript(next)
        this.broadcastContextUsage(next)
      }
    } catch (err) {
      this.transcriptCache.set(key, previousTranscript)
      const message = err instanceof Error ? err.message : String(err)
      this.failRun(this.currentState(sessionId) ?? state, ref, message)
    }
  }

  async replaceQueue(
    sessionId: string,
    messages: readonly QueuedAgentMessage[],
  ): Promise<void> {
    await this.ensureSession(sessionId)
    const timestamp = new Date().toISOString()
    this.setQueuedMessages(
      sessionId,
      messages.map((message) => {
        const attachments = cloneConductorImageAttachments(message.attachments)
        return {
          ...message,
          attachments,
          updatedAt: timestamp,
        }
      }),
    )
  }

  private async startTurn(
    sessionId: string,
    text: string,
    attachments: readonly ConductorComposerAttachment[] = [],
  ): Promise<void> {
    const live = this.sessions.get(sessionId)
    const initialState = live?.state ?? (await this.rehydrate(sessionId))
    if (!initialState) return
    let state: AgentChatSessionState = initialState

    const normalizedAttachments = cloneConductorImageAttachments(attachments)
    const promptText = conductorPromptText(text)
    let effectivePlan = state.plan
    if (isPlanApprovalMessage(text) || isPlanApprovalMessage(promptText)) {
      effectivePlan = false
      if (state.plan) {
        this.update(sessionId, { plan: false })
        state = { ...state, plan: false }
      }
    }
    const effectiveCanvas = detectCanvasIntent(promptText)
    const ref = this.refOf(state)
    this.emittedAssistantTextBySession.delete(sessionKey(ref))
    this.assistantDeltaDebugSequenceBySession.delete(sessionKey(ref))
    mobileDebugLog('agent-chat-host', 'startTurn', {
      sessionId,
      provider: state.provider,
      model: state.model,
      promptChars: promptText.length,
      attachmentCount: normalizedAttachments.length,
      plan: effectivePlan,
      canvas: effectiveCanvas,
    })
    this.turnTelemetry.set(sessionId, {
      submittedAt: performance.now(),
      driverEventCount: 0,
      assistantDeltaCount: 0,
      transcriptFlushCount: 0,
    })
    const previousTranscript = [...(this.transcriptCache.get(sessionKey(ref)) ?? [])]
    appendUserMessage(this.transcriptCache, ref, promptText, normalizedAttachments, effectivePlan)
    this.timelineState.userRequestedGeneratedImagesBySession.set(
      sessionKey(ref),
      userRequestedGeneratedImages(promptText),
    )
    this.flushTranscript(state)

    const driver = this.drivers[state.provider]
    if (!driver) {
      this.failRun(state, ref, `Unsupported agent provider: ${String(state.provider)}`)
      return
    }
    const authError = driver.checkAuth()
    if (authError) {
      this.failRun(state, ref, authError)
      return
    }

    const abort = new AbortController()
    this.update(state.sessionId, {
      status: 'running',
      runPhase: 'running',
      blockingQuestion: null,
      error: undefined,
    })
    this.markTurnRunning(sessionId, state)
    const running = this.sessions.get(sessionId)
    if (running) running.abort = abort
    // Drives the "Working…" indicator in the timeline.
    applyTimelineEvent(this.transcriptCache, this.snapshotEvent(ref, state, 'sessionUpdated', 'running'), this.timelineState)
    this.flushTranscript(this.currentState(sessionId))

    try {
      await driver.runTurn({
        sessionRef: ref,
        workspacePath: state.workspacePath,
        model: state.model,
        thinkingLevel: state.thinkingLevel,
        plan: effectivePlan,
        canvas: effectiveCanvas,
        text: promptText,
        attachments: normalizedAttachments,
        previousTranscript,
        providerSession: state.providerSession,
        signal: abort.signal,
        setProviderSession: (providerSession) => {
          const current = this.currentState(sessionId) ?? state
          this.update(sessionId, { providerSession })
          state = { ...current, providerSession }
        },
        setPiExtensionUi: (piExtensionUi) => {
          this.update(sessionId, { piExtensionUi })
        },
        emit: (event) => {
          this.markDriverEvent(sessionId, this.currentState(sessionId) ?? state, event)
          this.onDriverEvent(sessionId, event)
        },
      })
      if (abort.signal.aborted) {
        this.interruptRun(this.currentState(sessionId) ?? state, ref)
        this.clearTurnAbort(sessionId)
        await this.processSteerOrQueue(sessionId)
        return
      }
      applyTimelineEvent(this.transcriptCache, this.snapshotEvent(ref, state, 'runCompleted', 'idle'), this.timelineState)
      this.update(sessionId, { status: 'idle', runPhase: 'idle', blockingQuestion: null })
      void this.afterRunCompleted(this.currentState(sessionId) ?? state)
      this.clearTurnAbort(sessionId)
      await this.processQueueAfterTurn(sessionId)
    } catch (err) {
      if (abort.signal.aborted) {
        this.interruptRun(this.currentState(sessionId) ?? state, ref)
        this.clearTurnAbort(sessionId)
        await this.processSteerOrQueue(sessionId)
      } else {
        const message = err instanceof Error ? err.message : String(err)
        this.failRun(this.currentState(sessionId) ?? state, ref, message)
      }
    } finally {
      const finished = this.sessions.get(sessionId)
      if (finished) finished.abort = undefined
      const finalState = this.currentState(sessionId)
      if (finalState) {
        void measureMainAsync('conductor.persist', () => this.persist(finalState), {
          provider: finalState.provider,
          transcriptSize: this.transcriptCache.get(sessionKey(this.refOf(finalState)))?.length ?? 0,
        })
        this.flushTranscript(finalState)
      }
      this.finishTurnTelemetry(sessionId, finalState ?? state)
    }
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    await this.ensureSession(sessionId)
    this.update(sessionId, { model, error: undefined })
  }

  async setPlan(sessionId: string, plan: boolean): Promise<void> {
    await this.ensureSession(sessionId)
    this.update(sessionId, { plan, error: undefined })
  }

  async setCanvas(sessionId: string, canvas: boolean): Promise<void> {
    await this.ensureSession(sessionId)
    this.update(sessionId, { canvas, error: undefined })
  }

  async setThinkingLevel(sessionId: string, thinkingLevel: AgentChatSessionState['thinkingLevel']): Promise<void> {
    await this.ensureSession(sessionId)
    this.update(sessionId, { thinkingLevel, error: undefined })
  }

  async respondPiHostUi(sessionId: string, response: HostUiResponse): Promise<void> {
    const state = await this.resolveState(sessionId)
    if (!state || state.provider !== 'pi') return
    await this.drivers.pi.respondHostUi?.(sessionId, response)
    this.update(sessionId, { piExtensionUi: this.drivers.pi.getPiExtensionUi?.(sessionId) ?? null })
  }

  async sendPiExtensionTuiInput(sessionId: string, data: string): Promise<void> {
    const state = await this.resolveState(sessionId)
    if (!state || state.provider !== 'pi') return
    this.drivers.pi.sendExtensionTuiInput?.(sessionId, data)
    this.update(sessionId, { piExtensionUi: this.drivers.pi.getPiExtensionUi?.(sessionId) ?? null })
  }

  async listPiModels(workspacePath: string): Promise<readonly ModelPreset[]> {
    return this.drivers.pi.listModelsForWorkspace?.(workspacePath) ?? []
  }

  async cancel(sessionId: string): Promise<void> {
    const pending = this.sessions.get(sessionId)?.state.blockingQuestion
    if (pending) {
      this.questionBridge.reject(pending.requestId, 'User cancelled')
      this.update(sessionId, { runPhase: 'running', blockingQuestion: null })
    }
    this.sessions.get(sessionId)?.abort?.abort()
  }

  async respondBlockingQuestion(
    sessionId: string,
    response: ConductorBlockingQuestionResponse,
  ): Promise<void> {
    const state = this.sessions.get(sessionId)?.state ?? (await this.rehydrate(sessionId))
    if (!state?.blockingQuestion) return
    if (state.blockingQuestion.requestId !== response.requestId) return
    this.questionBridge.resolve(response.requestId, response.details)
    this.update(sessionId, { runPhase: 'running', blockingQuestion: null })
  }

  /** CI-only helper to exercise the real ask-user bridge without a live Codex turn. */
  async simulateCodexRequestUserInput(
    sessionId: string,
    questions: readonly ConductorAskQuestionPrompt[],
    itemId = 'ci-test-item',
  ): Promise<string> {
    const state = this.sessions.get(sessionId)?.state ?? (await this.rehydrate(sessionId))
    if (!state) throw new Error(`Unknown Conductor session: ${sessionId}`)
    const callId = `codex-ask-user:${itemId}`
    const pending = this.questionBridge.registerPending({
      sessionId,
      callId,
      provider: 'codex',
      source: 'askQuestion',
      questions,
    })
    void pending.catch(() => {})
    const requestId = this.sessions.get(sessionId)?.state.blockingQuestion?.requestId
    if (!requestId) {
      throw new Error('simulateCodexRequestUserInput failed to surface blockingQuestion')
    }
    return requestId
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.abort?.abort()
      this.drivers[session.state.provider]?.closeSession(sessionId)
      this.dropSessionRuntime(sessionId, this.refOf(session.state))
      this.sessions.delete(sessionId)
    } else {
      const stored = await this.store.getSession(sessionId)
      if (stored) {
        this.drivers[stored.provider]?.closeSession(sessionId)
        this.dropSessionRuntime(sessionId, {
          workspaceId: stored.workspaceId,
          sessionId: stored.sessionId,
        })
      }
    }
    await this.store.deleteSession(sessionId)
  }

  dispose(): void {
    for (const [sessionId, session] of this.sessions) {
      session.abort?.abort()
      this.drivers[session.state.provider]?.closeSession(sessionId)
    }
    this.sessions.clear()
    this.turnTelemetry.clear()
  }

  // ── internals ──────────────────────────────────────────────────────────

  private onDriverEvent(sessionId: string, event: SessionDriverEvent): void {
    const state = this.currentState(sessionId)
    if (!state) return
    if (event.type === 'assistantDelta') {
      const key = sessionKey(event.sessionRef)
      const emitted = this.emittedAssistantTextBySession.get(key) ?? ''
      const { delta, emitted: nextEmitted } = appendAssistantStreamDelta(emitted, event.text)
      if (delta.length === 0) {
        return
      }
      const sequence = (this.assistantDeltaDebugSequenceBySession.get(key) ?? 0) + 1
      this.assistantDeltaDebugSequenceBySession.set(key, sequence)
      if (shouldSampleMobileDelta(sequence)) {
        mobileDebugLog('agent-chat-host', 'assistantDelta append', {
          sessionId,
          sequence,
          incomingChars: event.text.length,
          deltaChars: delta.length,
          emittedChars: nextEmitted.length,
          incomingPreview: event.text.slice(0, 48),
          deltaPreview: delta.slice(0, 48),
        })
      }
      this.emittedAssistantTextBySession.set(key, nextEmitted)
      const messageId = appendAssistantDelta(
        this.transcriptCache,
        this.timelineState.activeAssistantMessageBySession,
        event.sessionRef,
        delta,
      )
      if (messageId) {
        // Token stream: send only the delta. Full transcript IPC on every token
        // duplicated multi‑MB payloads and OOM'd the main process heap.
        this.markAssistantDelta(sessionId, state)
        this.broadcastDelta(state, messageId, delta)
      }
      return
    }
    if (event.type === 'toolStarted') {
      this.emittedAssistantTextBySession.delete(sessionKey(event.sessionRef))
      this.assistantDeltaDebugSequenceBySession.delete(sessionKey(event.sessionRef))
    }
    applyTimelineEvent(this.transcriptCache, event, this.timelineState)
    if (event.type === 'toolFinished' && event.success) {
      // SDKs stream only changed paths (Codex) or opaque args (Cursor), never line
      // content, so reconstruct real green/red diffs from the workspace git repo.
      void this.attachFileChangeDiff(state, event.callId, event.output)
      void this.attachGeneratedImages(state, event.callId, event.output)
    }
    if (event.type === 'runCompleted') {
      const completedAt = Date.parse(event.timestamp)
      void this.afterRunCompleted(
        state,
        Number.isFinite(completedAt) ? completedAt - 15 * 60 * 1000 : undefined,
      )
    }
    this.broadcastTranscript(state)
  }

  /**
   * For file-editing tools, rebuild a unified patch from git and attach it to the
   * tool row so the renderer can show real diffs. Best-effort: diffing must never
   * fail a run, so all errors fall back to the file+kind chips already shown.
   */
  private async attachFileChangeDiff(
    state: AgentChatSessionState,
    callId: string,
    output: unknown,
  ): Promise<void> {
    try {
      const key = sessionKey(this.refOf(state))
      const transcript = this.transcriptCache.get(key)
      if (!transcript) return
      const tool = transcript.find((item) => item.kind === 'tool' && item.callId === callId)
      if (!tool || tool.kind !== 'tool' || !isFileChangeTool(tool.toolName)) return

      const paths = extractChangedPaths(tool.input, output)
      if (paths.length === 0) return

      const files: Array<{ path: string; patch: string }> = []
      for (const path of paths) {
        try {
          const patch = await GitService.getFileDiff(state.workspacePath, path)
          if (patch && patch.trim()) files.push({ path, patch })
        } catch {
          // ignore a single path; never fail the run over a diff
        }
      }
      if (files.length === 0) return

      const current = this.transcriptCache.get(key)
      if (!current) return
      const idx = current.findIndex((item) => item.kind === 'tool' && item.callId === callId)
      if (idx < 0) return
      const target = current[idx]
      if (target.kind !== 'tool') return
      const next = [...current]
      next[idx] = { ...target, output: { kind: 'fileChange', files } }
      this.transcriptCache.set(key, next)
      this.flushTranscript(this.currentState(state.sessionId) ?? state)
    } catch {
      // swallow — diff reconstruction is purely additive
    }
  }

  /** Hydrate generated-image tool rows from workspace files or inline payloads. */
  private async attachGeneratedImages(
    state: AgentChatSessionState,
    callId: string,
    output: unknown,
  ): Promise<void> {
    try {
      const key = sessionKey(this.refOf(state))
      const transcript = this.transcriptCache.get(key)
      if (!transcript) return
      const tool = transcript.find((item) => item.kind === 'tool' && item.callId === callId)
      if (!tool || tool.kind !== 'tool') return
      if (!this.timelineState.userRequestedGeneratedImagesBySession.get(key)) return

      const provider = state.provider === 'pi' ? undefined : state.provider
      const resolved = await resolveConductorGeneratedImagesWithFiles(
        isConductorGeneratedImageOutput(tool.output) ? tool.output : output,
        {
          workspacePath: state.workspacePath,
          toolName: tool.toolName,
          input: tool.input,
          provider,
          sinceMs: this.turnStartedAtMs(state),
        },
      )
      if (resolved && hasRenderableGeneratedImageOutput(resolved)) {
        this.updateToolGeneratedImages(state, callId, resolved)
      }
    } catch {
      // best-effort — image rendering must never fail a run
    }
  }

  /** Poll after turn completion — Codex imagegen may land on disk after the SDK stream ends. */
  private async afterRunCompleted(
    state: AgentChatSessionState,
    sinceMsFallback?: number,
  ): Promise<void> {
    const retryDelaysMs = [0, 800, 2000, 4000]
    let shouldRetry = false

    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) {
        if (!shouldRetry) return
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      const attached = await this.attachGeneratedImagesFromAssistant(state, sinceMsFallback)
      if (attached) return

      if (!shouldRetry) {
        shouldRetry = this.currentTurnLooksLikeGeneratedImage(state)
      }
    }
  }

  private currentTurnLooksLikeGeneratedImage(state: AgentChatSessionState): boolean {
    const key = sessionKey(this.refOf(state))
    if (!this.timelineState.userRequestedGeneratedImagesBySession.get(key)) return false

    const transcript = this.transcriptCache.get(key)
    if (!transcript) return false

    let lastUserIndex = -1
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const item = transcript[index]
      if (item.kind === 'message' && item.role === 'user') {
        lastUserIndex = index
        break
      }
    }

    const turnSlice = transcript.slice(lastUserIndex >= 0 ? lastUserIndex + 1 : 0)
    return looksLikeGeneratedImageCompletionText(turnTranscriptText(turnSlice))
  }

  /** When the assistant mentions a saved image path, add a post-turn image block. */
  private async attachGeneratedImagesFromAssistant(
    state: AgentChatSessionState,
    sinceMsFallback?: number,
  ): Promise<boolean> {
    try {
      const key = sessionKey(this.refOf(state))
      const transcript = this.transcriptCache.get(key)
      if (!transcript) return false

      let lastUserIndex = -1
      let lastAssistantIndex = -1
      for (let index = transcript.length - 1; index >= 0; index -= 1) {
        const item = transcript[index]
        if (item.kind === 'message' && item.role === 'user' && lastUserIndex < 0) {
          lastUserIndex = index
        }
        if (item.kind === 'message' && item.role === 'assistant' && lastAssistantIndex < 0) {
          lastAssistantIndex = index
        }
        if (lastUserIndex >= 0 && lastAssistantIndex >= 0) break
      }
      if (lastAssistantIndex < 0) return false

      if (!this.timelineState.userRequestedGeneratedImagesBySession.get(key)) return false

      const turnSlice = transcript.slice(lastUserIndex >= 0 ? lastUserIndex + 1 : 0)
      if (
        turnSlice.some(
          (item) =>
            item.kind === 'tool' &&
            isGeneratedImageToolCall(item, { userRequestedImages: true }) &&
            hasRenderableGeneratedImageOutput(item.output),
        )
      ) {
        return true
      }

      const message = transcript[lastAssistantIndex]
      if (message.kind !== 'message' || message.role !== 'assistant') return false

      const sinceMs = this.turnStartedAtMs(state) ?? sinceMsFallback
      const provider = state.provider === 'pi' ? undefined : state.provider
      const generated = await loadGeneratedImagesForTurn(
        turnTranscriptText(turnSlice),
        state.workspacePath,
        {
          provider,
          sinceMs,
        },
      )
      if (!generated || !hasRenderableGeneratedImageOutput(generated)) return false

      const callId = `generated-image:${message.id}`
      const current = this.transcriptCache.get(key)
      if (!current) return false
      if (current.some((item) => item.kind === 'tool' && item.callId === callId)) return true

      const tool = makeToolItem(
        callId,
        'generateImage',
        'success',
        generated.images.length === 1 ? 'Generated image' : `Generated ${generated.images.length} images`,
        {
          detail: generated.images[0]?.prompt ?? generated.images[0]?.name ?? generated.images[0]?.filePath,
          output: generated,
        },
      )

      const next = [...current]
      next.splice(lastAssistantIndex + 1, 0, tool)
      this.transcriptCache.set(key, next)
      this.flushTranscript(this.currentState(state.sessionId) ?? state)
      return true
    } catch {
      // best-effort
      return false
    }
  }

  private turnStartedAtMs(state: AgentChatSessionState): number | undefined {
    const metrics = this.timelineState.runMetricsBySession.get(sessionKey(this.refOf(state)))
    if (!metrics?.startedAt) return undefined
    const parsed = Date.parse(metrics.startedAt)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  private updateToolGeneratedImages(
    state: AgentChatSessionState,
    callId: string,
    output: ConductorGeneratedImageOutput,
  ): void {
    const key = sessionKey(this.refOf(state))
    const current = this.transcriptCache.get(key)
    if (!current) return
    const idx = current.findIndex((item) => item.kind === 'tool' && item.callId === callId)
    if (idx < 0) return
    const target = current[idx]
    if (target.kind !== 'tool') return
    if (!hasRenderableGeneratedImageOutput(output)) return

    const next = [...current]
    next[idx] = {
      ...target,
      label: output.images.length === 1 ? 'Generated image' : `Generated ${output.images.length} images`,
      detail: output.images[0]?.prompt ?? output.images[0]?.name ?? output.images[0]?.filePath,
      output,
    }
    this.transcriptCache.set(key, next)
    this.flushTranscript(this.currentState(state.sessionId) ?? state)
  }

  /**
   * User-initiated stop: record the run duration (so the footer can show it) and a
   * Stopped marker the renderer turns into an INTERRUPTED BY USER pill.
   */
  private interruptRun(state: AgentChatSessionState, ref: SessionRef): void {
    this.invalidateCodexThreadAfterStop(state)
    this.finalizeRunningTools(ref)
    applyTimelineEvent(
      this.transcriptCache,
      this.snapshotEvent(ref, state, 'runCompleted', 'idle'),
      this.timelineState,
    )
    applyTimelineEvent(
      this.transcriptCache,
      { type: 'sessionClosed', sessionRef: ref, timestamp: new Date().toISOString() } as SessionDriverEvent,
      this.timelineState,
    )
    this.update(state.sessionId, { status: 'idle', runPhase: 'idle', blockingQuestion: null })
    void this.afterRunCompleted(this.currentState(state.sessionId) ?? state)
  }

  private setBlockingQuestion(
    sessionId: string,
    question: NonNullable<AgentChatSessionState['blockingQuestion']>,
  ): void {
    this.update(sessionId, { runPhase: 'awaitingUser', blockingQuestion: question })
  }

  /**
   * After stale CLI resume, force the next Codex turn to seed Conductor transcript.
   * User interrupt is handled via SDK `AbortSignal` in `CodexDriver.runTurnOnce` (finally).
   */
  private invalidateCodexThreadAfterStop(state: AgentChatSessionState, errMessage?: string): void {
    if (state.provider !== 'codex' || errMessage === undefined) return
    const lower = errMessage.toLowerCase()
    if (lower.includes('thread/resume') || lower.includes('no rollout')) {
      this.drivers.codex.markSessionInterrupted?.(state.sessionId)
    }
  }

  /** Mark in-flight tool rows as failed so shell/bash chips do not stay running after Esc/stop. */
  private finalizeRunningTools(ref: SessionRef): void {
    const key = sessionKey(ref)
    const transcript = this.transcriptCache.get(key)
    if (!transcript) return
    for (const item of transcript) {
      if (item.kind === 'tool' && item.status === 'running') {
        applyTimelineEvent(
          this.transcriptCache,
          evToolFinished(ref, item.callId, false, undefined),
          this.timelineState,
        )
      }
    }
  }

  private failRun(state: AgentChatSessionState, ref: SessionRef, message: string): void {
    this.invalidateCodexThreadAfterStop(state, message)
    applyTimelineEvent(this.transcriptCache, this.failEvent(ref, message), this.timelineState)
    this.update(state.sessionId, { status: 'failed', runPhase: 'failed', blockingQuestion: null, error: message })
    const next = this.currentState(state.sessionId)
    if (next) {
      void measureMainAsync('conductor.persist', () => this.persist(next), {
        provider: next.provider,
        transcriptSize: this.transcriptCache.get(sessionKey(this.refOf(next)))?.length ?? 0,
      })
      this.flushTranscript(next)
    }
    this.finishTurnTelemetry(state.sessionId, next ?? state)
  }

  /** Rehydrate from disk when IPC arrives before getSession (e.g. quick plan toggle). */
  private async ensureSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) return
    await this.rehydrate(sessionId)
  }

  private update(sessionId: string, patch: Partial<AgentChatSessionState>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const clearsError = 'error' in patch && patch.error === undefined && session.state.error != null
    let state: AgentChatSessionState = {
      ...session.state,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    if (clearsError && state.status === 'failed') {
      state = { ...state, status: 'idle' }
    }
    session.state = state
    void this.store.upsertSession(session.state)
    this.broadcastState(session.state)
  }

  private currentState(sessionId: string): AgentChatSessionState | undefined {
    return this.sessions.get(sessionId)?.state
  }

  private async resolveState(sessionId: string): Promise<AgentChatSessionState | null> {
    const live = this.sessions.get(sessionId)?.state
    if (live) return live
    return this.rehydrate(sessionId)
  }

  private setQueuedMessages(
    sessionId: string,
    queuedMessages: readonly QueuedAgentMessage[],
  ): void {
    this.update(sessionId, { queuedMessages })
  }

  private clearTurnAbort(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.abort = undefined
  }

  private async processSteerOrQueue(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.state.status === 'running') return

    const steerIndex = findSteerMessageIndex(session.state.queuedMessages)
    if (steerIndex >= 0) {
      const steer = session.state.queuedMessages[steerIndex]
      const remaining = session.state.queuedMessages.filter((_, index) => index !== steerIndex)
      this.setQueuedMessages(sessionId, remaining)
      await this.startTurn(sessionId, steer.text, steer.attachments)
      return
    }

    await this.processQueueAfterTurn(sessionId)
  }

  private async processQueueAfterTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.state.status === 'running') return

    const [next, ...remaining] = session.state.queuedMessages
    if (!next) return

    this.setQueuedMessages(sessionId, remaining)
    await this.startTurn(sessionId, next.text, next.attachments)
  }

  private normalizeStoredSession(stored: AgentChatSessionState): AgentChatSessionState {
    const inferred = thinkingLevelFromModel(stored.model)
    const { base, speedSuffix } = parseModelEffort(stored.model)
    const model = speedSuffix ? `${base}-fast` : base
    const thinkingLevel =
      inferred !== 'medium' ? inferred : normalizeThinkingLevel(stored.thinkingLevel)
    return {
      ...stored,
      provider: normalizeConductorDefaultProvider(stored.provider),
      model,
      thinkingLevel,
      canvas: stored.canvas ?? false,
      queuedMessages: stored.queuedMessages ?? [],
      runPhase: stored.runPhase ?? 'idle',
      blockingQuestion: stored.blockingQuestion ?? null,
      piExtensionUi: stored.piExtensionUi ?? null,
    }
  }

  private async rehydrate(sessionId: string): Promise<AgentChatSessionState | null> {
    const stored = await this.store.getSession(sessionId)
    if (!stored) return null
    // A run cannot survive a restart, so any "running" status is stale.
    const normalized = this.normalizeStoredSession({
      ...stored,
      status: stored.status === 'running' ? 'idle' : stored.status,
      runPhase: stored.status === 'running' ? 'idle' : (stored.runPhase ?? 'idle'),
      blockingQuestion: null,
      queuedMessages: stored.queuedMessages ?? [],
    })
    const state: AgentChatSessionState = normalized
    this.sessions.set(sessionId, { state })
    const key = sessionKey(this.refOf(state))
    if (!this.transcriptCache.has(key)) {
      this.transcriptCache.set(key, await this.store.loadTranscript(sessionId))
    }
    return state
  }

  private async persist(state: AgentChatSessionState): Promise<void> {
    const transcript = this.transcriptCache.get(sessionKey(this.refOf(state))) ?? []
    await this.store.saveTranscript(state.sessionId, transcript)
  }

  private refOf(state: AgentChatSessionState): SessionRef {
    return { workspaceId: state.workspaceId, sessionId: state.sessionId }
  }

  /** Tear down in-memory transcript/timeline state when a session tab closes. */
  private dropSessionRuntime(sessionId: string, ref: SessionRef): void {
    const key = sessionKey(ref)
    this.transcriptCache.delete(key)
    this.timelineState.runMetricsBySession.delete(key)
    this.timelineState.runningSinceBySession.delete(key)
    this.timelineState.activeAssistantMessageBySession.delete(key)
    this.timelineState.activeWorkingActivityBySession.delete(key)
    this.timelineState.userRequestedGeneratedImagesBySession.delete(key)
    this.emittedAssistantTextBySession.delete(key)
    this.assistantDeltaDebugSequenceBySession.delete(key)
    const pending = this.pendingTranscriptFlush.get(sessionId)
    if (pending) {
      clearTimeout(pending)
      this.pendingTranscriptFlush.delete(sessionId)
    }
    this.turnTelemetry.delete(sessionId)
  }

  private markTurnRunning(sessionId: string, state: AgentChatSessionState): void {
    const telemetry = this.turnTelemetry.get(sessionId)
    if (!telemetry || telemetry.runningAt !== undefined) return
    const runningAt = performance.now()
    telemetry.runningAt = runningAt
    logMainPerfEvent('conductor.submit_to_running', runningAt - telemetry.submittedAt, {
      provider: state.provider,
      model: state.model,
      thinkingLevel: state.thinkingLevel,
    })
  }

  private markDriverEvent(
    sessionId: string,
    state: AgentChatSessionState,
    event: SessionDriverEvent,
  ): void {
    const telemetry = this.turnTelemetry.get(sessionId)
    if (!telemetry) return
    telemetry.driverEventCount += 1
    if (telemetry.firstDriverEventAt !== undefined) return
    const firstDriverEventAt = performance.now()
    telemetry.firstDriverEventAt = firstDriverEventAt
    logMainPerfEvent(
      'conductor.running_to_first_driver_event',
      firstDriverEventAt - (telemetry.runningAt ?? telemetry.submittedAt),
      {
        provider: state.provider,
        model: state.model,
        eventType: event.type,
      },
    )
  }

  private markAssistantDelta(sessionId: string, state: AgentChatSessionState): void {
    const telemetry = this.turnTelemetry.get(sessionId)
    if (!telemetry) return
    telemetry.assistantDeltaCount += 1
    if (telemetry.firstAssistantDeltaAt !== undefined) return
    const firstAssistantDeltaAt = performance.now()
    telemetry.firstAssistantDeltaAt = firstAssistantDeltaAt
    logMainPerfEvent(
      'conductor.submit_to_first_assistant_delta',
      firstAssistantDeltaAt - telemetry.submittedAt,
      {
        provider: state.provider,
        model: state.model,
        driverEventCount: telemetry.driverEventCount,
      },
    )
  }

  private finishTurnTelemetry(sessionId: string, state: AgentChatSessionState): void {
    const telemetry = this.turnTelemetry.get(sessionId)
    if (!telemetry) return
    this.turnTelemetry.delete(sessionId)
    logMainPerfEvent('conductor.turn_total', performance.now() - telemetry.submittedAt, {
      provider: state.provider,
      model: state.model,
      driverEventCount: telemetry.driverEventCount,
      assistantDeltaCount: telemetry.assistantDeltaCount,
      transcriptFlushCount: telemetry.transcriptFlushCount,
    })
  }

  private snapshotEvent(
    ref: SessionRef,
    state: AgentChatSessionState,
    type: 'sessionUpdated' | 'runCompleted',
    status: AgentChatStatus,
  ): SessionDriverEvent {
    const snapshot: SessionSnapshot = {
      ref,
      workspace: { workspaceId: state.workspaceId, path: state.workspacePath },
      title: state.title,
      status,
      updatedAt: new Date().toISOString(),
      ...(status === 'running' ? { runningRunId: 'run' } : {}),
    }
    return { type, sessionRef: ref, timestamp: snapshot.updatedAt, snapshot } as SessionDriverEvent
  }

  private failEvent(ref: SessionRef, message: string): SessionDriverEvent {
    return { type: 'runFailed', sessionRef: ref, timestamp: new Date().toISOString(), error: { message } }
  }

  private broadcastState(state: AgentChatSessionState): void {
    this.send(IPC.AGENT_CHAT_STATE_CHANGED, state)
  }

  private broadcastTranscript(state: AgentChatSessionState | undefined): void {
    if (!state) return
    const sessionId = state.sessionId
    if (this.pendingTranscriptFlush.has(sessionId)) return
    const timer = setTimeout(() => {
      this.pendingTranscriptFlush.delete(sessionId)
      this.flushTranscript(this.currentState(sessionId) ?? state)
    }, AgentChatHost.TRANSCRIPT_FLUSH_MS)
    this.pendingTranscriptFlush.set(sessionId, timer)
  }

  private flushTranscript(state: AgentChatSessionState | undefined): void {
    if (!state) return
    const pending = this.pendingTranscriptFlush.get(state.sessionId)
    if (pending) {
      clearTimeout(pending)
      this.pendingTranscriptFlush.delete(state.sessionId)
    }
    const transcript = this.transcriptCache.get(sessionKey(this.refOf(state))) ?? []
    const started = performance.now()
    this.send(IPC.AGENT_CHAT_TRANSCRIPT_CHANGED, { sessionId: state.sessionId, transcript })
    this.broadcastContextUsage(state)
    const telemetry = this.turnTelemetry.get(state.sessionId)
    if (telemetry) telemetry.transcriptFlushCount += 1
    logMainPerfEvent('conductor.transcript_flush', performance.now() - started, {
      provider: state.provider,
      transcriptSize: transcript.length,
    })
  }

  private broadcastDelta(state: AgentChatSessionState, messageId: string, text: string): void {
    const started = performance.now()
    this.send(IPC.AGENT_CHAT_ASSISTANT_DELTA, { sessionId: state.sessionId, messageId, text })
    logMainPerfEvent('conductor.assistant_delta_send', performance.now() - started, {
      provider: state.provider,
      chars: text.length,
    })
  }

  private send(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
    if (this.broadcastListeners.size > 0) {
      for (const listener of this.broadcastListeners) {
        try {
          listener(channel, payload)
        } catch (error) {
          // Mobile event bridge faults must never break the desktop UI feed.
          console.warn('[agent-chat-host] broadcast listener failed', error)
        }
      }
    }
  }

  // Mobile event bridge taps into the same outbound stream the renderer sees;
  // returns a disposer so callers can clean up on shutdown.
  subscribeBroadcasts(listener: AgentChatBroadcastListener): () => void {
    this.broadcastListeners.add(listener)
    return () => {
      this.broadcastListeners.delete(listener)
    }
  }
}

/** Tool names (Codex + Cursor) that mutate files and should carry a reconstructed diff. */
function isFileChangeTool(name: string): boolean {
  const n = name.toLowerCase()
  return /(apply_patch|file_change|edit|write|str_replace|search_replace|create_file|apply_diff)/.test(n)
}

const PATH_KEYS = [
  'path',
  'file_path',
  'filePath',
  'target_file',
  'targetFile',
  'relative_path',
  'relativePath',
  'file',
]

/** Codex `file_change` items pass `changes: { path, kind }[]` as tool input. */
function collectCodexFileChangePaths(value: unknown, out: Set<string>): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const path = (entry as { path?: unknown }).path
    if (typeof path === 'string' && path.trim()) out.add(path.trim())
  }
}

/** Pull every plausible changed file path out of a tool's input/output payloads. */
function extractChangedPaths(input: unknown, output: unknown): string[] {
  const found = new Set<string>()
  collectCodexFileChangePaths(input, found)
  collectCodexFileChangePaths(output, found)
  collectPaths(input, found, 0)
  collectPaths(output, found, 0)
  return [...found]
}

function collectPaths(value: unknown, out: Set<string>, depth: number): void {
  if (!value || depth > 6) return
  if (Array.isArray(value)) {
    for (const entry of value) collectPaths(entry, out, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const record = value as Record<string, unknown>
  for (const key of PATH_KEYS) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) out.add(candidate.trim())
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') collectPaths(nested, out, depth + 1)
  }
}

let host: AgentChatHost | null = null

export function getAgentChatHost(): AgentChatHost {
  if (!host) host = new AgentChatHost()
  return host
}
