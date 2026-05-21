import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { sessionKey } from '@pi-gui/pi-sdk-driver'
import type { SessionDriverEvent, SessionRef, SessionSnapshot } from '@pi-gui/session-driver'
import { IPC } from '../shared/ipc-channels'
import type { TranscriptMessage } from '../shared/pi/pi-desktop-state'
import {
  appendAssistantDelta,
  appendUserMessage,
  applyTimelineEvent,
  type TimelineRuntimeState,
} from './pi-timeline'
import { AgentChatStore } from './agent-chat-store'
import { GitService } from './git-service'
import { evToolFinished, type AgentDriver } from './agents/agent-driver'
import { CodexDriver } from './agents/codex-driver'
import { CursorDriver } from './agents/cursor-driver'
import {
  cloneTranscriptWithNewIds,
  sliceTranscriptForFork,
} from '../shared/conductor-transcript-utils'
import { thinkingLevelFromModel, parseModelEffort } from '../shared/conductor-model-utils'
import { normalizeThinkingLevel } from '../shared/conductor-thinking'
import type {
  AgentChatSessionState,
  AgentChatStatus,
  AgentProvider,
  CreateAgentChatSessionInput,
  ForkAgentChatSessionInput,
} from '../shared/agent-chat-types'

export type { AgentChatSessionState, CreateAgentChatSessionInput }

interface RuntimeSession {
  state: AgentChatSessionState
  abort?: AbortController
}

export class AgentChatHost {
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly transcriptCache = new Map<string, TranscriptMessage[]>()
  private readonly timelineState: TimelineRuntimeState = {
    runMetricsBySession: new Map(),
    runningSinceBySession: new Map(),
    activeAssistantMessageBySession: new Map(),
    activeWorkingActivityBySession: new Map(),
  }
  private readonly store = new AgentChatStore()
  private readonly drivers: Record<AgentProvider, AgentDriver> = {
    codex: new CodexDriver(),
    cursor: new CursorDriver(),
  }
  /** Coalesces high-frequency transcript broadcasts during streaming (~25fps). */
  private readonly pendingTranscriptFlush = new Map<string, ReturnType<typeof setTimeout>>()
  private static readonly TRANSCRIPT_FLUSH_MS = 40

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
      status: 'idle',
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

  async submit(sessionId: string, text: string): Promise<void> {
    const trimmed = text.trim()
    const live = this.sessions.get(sessionId)
    if (live?.state.status === 'running' || live?.abort) {
      return
    }
    const session = live
    const state = session?.state ?? (await this.rehydrate(sessionId))
    if (!state || trimmed.length === 0) return

    const ref = this.refOf(state)
    appendUserMessage(this.transcriptCache, ref, trimmed, [], state.plan)
    this.flushTranscript(state)

    const driver = this.drivers[state.provider]
    const authError = driver.checkAuth()
    if (authError) {
      this.failRun(state, ref, authError)
      return
    }

    const abort = new AbortController()
    this.update(state.sessionId, { status: 'running', error: undefined })
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
        plan: state.plan,
        text: trimmed,
        signal: abort.signal,
        emit: (event) => this.onDriverEvent(sessionId, event),
      })
      applyTimelineEvent(this.transcriptCache, this.snapshotEvent(ref, state, 'runCompleted', 'idle'), this.timelineState)
      this.update(sessionId, { status: 'idle' })
    } catch (err) {
      if (abort.signal.aborted) {
        this.interruptRun(this.currentState(sessionId) ?? state, ref)
      } else {
        const message = err instanceof Error ? err.message : String(err)
        this.failRun(this.currentState(sessionId) ?? state, ref, message)
      }
    } finally {
      const finished = this.sessions.get(sessionId)
      if (finished) finished.abort = undefined
      const finalState = this.currentState(sessionId)
      if (finalState) {
        void this.persist(finalState)
        this.flushTranscript(finalState)
      }
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

  async setThinkingLevel(sessionId: string, thinkingLevel: AgentChatSessionState['thinkingLevel']): Promise<void> {
    await this.ensureSession(sessionId)
    this.update(sessionId, { thinkingLevel, error: undefined })
  }

  async cancel(sessionId: string): Promise<void> {
    this.sessions.get(sessionId)?.abort?.abort()
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.abort?.abort()
      this.drivers[session.state.provider].closeSession(sessionId)
      this.dropSessionRuntime(sessionId, this.refOf(session.state))
      this.sessions.delete(sessionId)
    } else {
      const stored = await this.store.getSession(sessionId)
      if (stored) {
        this.drivers[stored.provider].closeSession(sessionId)
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
      this.drivers[session.state.provider].closeSession(sessionId)
    }
    this.sessions.clear()
  }

  // ── internals ──────────────────────────────────────────────────────────

  private onDriverEvent(sessionId: string, event: SessionDriverEvent): void {
    const state = this.currentState(sessionId)
    if (!state) return
    if (event.type === 'assistantDelta') {
      const messageId = appendAssistantDelta(
        this.transcriptCache,
        this.timelineState.activeAssistantMessageBySession,
        event.sessionRef,
        event.text,
      )
      if (messageId) {
        // Token stream: send only the delta. Full transcript IPC on every token
        // duplicated multi‑MB payloads and OOM'd the main process heap.
        this.broadcastDelta(state, messageId, event.text)
      }
      return
    }
    applyTimelineEvent(this.transcriptCache, event, this.timelineState)
    if (event.type === 'toolFinished' && event.success) {
      // SDKs stream only changed paths (Codex) or opaque args (Cursor), never line
      // content, so reconstruct real green/red diffs from the workspace git repo.
      void this.attachFileChangeDiff(state, event.callId, event.output)
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

  /**
   * User-initiated stop: record the run duration (so the footer can show it) and a
   * Stopped marker the renderer turns into an INTERRUPTED BY USER pill.
   */
  private interruptRun(state: AgentChatSessionState, ref: SessionRef): void {
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
    this.update(state.sessionId, { status: 'idle' })
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
    applyTimelineEvent(this.transcriptCache, this.failEvent(ref, message), this.timelineState)
    this.update(state.sessionId, { status: 'failed', error: message })
    const next = this.currentState(state.sessionId)
    if (next) {
      void this.persist(next)
      this.flushTranscript(next)
    }
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

  private normalizeStoredSession(stored: AgentChatSessionState): AgentChatSessionState {
    const inferred = thinkingLevelFromModel(stored.model)
    const { base, speedSuffix } = parseModelEffort(stored.model)
    const model = speedSuffix ? `${base}-fast` : base
    const thinkingLevel =
      inferred !== 'medium' ? inferred : normalizeThinkingLevel(stored.thinkingLevel)
    return { ...stored, model, thinkingLevel }
  }

  private async rehydrate(sessionId: string): Promise<AgentChatSessionState | null> {
    const stored = await this.store.getSession(sessionId)
    if (!stored) return null
    // A run cannot survive a restart, so any "running" status is stale.
    const normalized = this.normalizeStoredSession({
      ...stored,
      status: stored.status === 'running' ? 'idle' : stored.status,
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
    const pending = this.pendingTranscriptFlush.get(sessionId)
    if (pending) {
      clearTimeout(pending)
      this.pendingTranscriptFlush.delete(sessionId)
    }
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
    this.send(IPC.AGENT_CHAT_TRANSCRIPT_CHANGED, { sessionId: state.sessionId, transcript })
  }

  private broadcastDelta(state: AgentChatSessionState, messageId: string, text: string): void {
    this.send(IPC.AGENT_CHAT_ASSISTANT_DELTA, { sessionId: state.sessionId, messageId, text })
  }

  private send(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
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
