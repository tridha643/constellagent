/**
 * In-process Pi SDK host (pi-gui–style): PiSdkDriver + JsonCatalogStore under userData only.
 */
import { BrowserWindow } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { SessionCatalogEntry } from '@pi-gui/catalogs'
import {
  createPiSdkDriver,
  type PiSdkDriver,
  sessionKey,
} from '@pi-gui/pi-sdk-driver'
import type {
  ExtensionCompatibilityIssue,
  HostUiResponse,
  PiContextUsageSnapshot,
  PiSessionExtensionUiSnapshot,
  SessionConfig,
  SessionDriverEvent,
  SessionRef,
} from '@pi-gui/session-driver'
import type { RuntimeSnapshot } from '@pi-gui/session-driver/runtime-types'
import { IPC } from '../shared/ipc-channels'
import {
  createEmptyDesktopAppState,
  type ComposerAttachment,
  type DesktopAppState,
  type ExtensionCommandCompatibilityRecord,
  type SelectedTranscriptRecord,
  type SessionExtensionUiStateRecord,
  type WorkspaceSessionTarget,
} from '../shared/pi/pi-desktop-state'
import {
  buildWorkspaceRecords,
  buildWorktreeRecords,
  cloneComposerAttachments,
  mapToRecord,
  toSessionAttachments,
  toSessionRef,
  toTranscriptAttachments,
} from './pi-app-store-utils'
import {
  appendAssistantDelta,
  applyTimelineEvent,
  appendUserMessage,
  type RunMetrics,
} from './pi-timeline'
import { applySessionEventState } from './pi-session-state'
import type { TranscriptMessage } from '../shared/pi/pi-desktop-state'
import type { TimelineRuntimeState } from './pi-timeline'

function resolveSelectedWorkspaceIdFromCatalog(
  preferredWorkspaceId: string,
  workspaces: readonly { workspaceId: string }[],
): string {
  if (preferredWorkspaceId && workspaces.some((w) => w.workspaceId === preferredWorkspaceId)) {
    return preferredWorkspaceId
  }
  return workspaces[0]?.workspaceId ?? ''
}

function resolveSelectedSessionIdFromCatalog(
  workspaceId: string,
  preferredSessionId: string,
  sessions: readonly SessionCatalogEntry[],
): string {
  const workspaceSessions = sessions.filter((session) => session.workspaceId === workspaceId)
  if (!workspaceSessions.length) {
    return ''
  }
  if (
    preferredSessionId &&
    workspaceSessions.some((session) => session.sessionRef.sessionId === preferredSessionId)
  ) {
    return preferredSessionId
  }
  return workspaceSessions[0]?.sessionRef.sessionId ?? ''
}

function mapPiExtensionUiSnapshot(snap: PiSessionExtensionUiSnapshot): SessionExtensionUiStateRecord {
  return {
    statuses: snap.statuses,
    widgets: snap.widgets,
    pendingDialogs: snap.pendingDialogs,
    title: snap.title,
    editorText: snap.editorText,
    tuiCustom: snap.tuiCustom,
  }
}

function commandNameFromCompatibilityIssue(issue: ExtensionCompatibilityIssue): string {
  const fromMessage = issue.message.match(/^\/([^\s/]+)\s+requires\b/i)
  if (fromMessage?.[1]) {
    return fromMessage[1].replace(/^\/+/, '')
  }
  if (issue.eventName) {
    return issue.eventName.replace(/^\/+/, '').split(/\s/)[0] ?? 'extension'
  }
  const pathTail = issue.extensionPath?.split(/[/\\]/).filter(Boolean).pop()
  return pathTail && pathTail.length > 0 ? pathTail : 'extension'
}

export class ConstellPiHost {
  readonly driver: PiSdkDriver
  private readonly dataDir: string
  state: DesktopAppState = createEmptyDesktopAppState()
  private readonly transcriptCache = new Map<string, TranscriptMessage[]>()
  private readonly activeAssistantMessageBySession = new Map<string, string>()
  private readonly runningSinceBySession = new Map<string, string>()
  private readonly runMetricsBySession = new Map<string, RunMetrics>()
  private readonly activeWorkingActivityBySession = new Map<string, string>()
  private readonly sessionSubscriptions = new Map<string, () => void>()
  private readonly sessionConfigBySession = new Map<string, SessionConfig>()
  private readonly lastViewedAtBySession = new Map<string, string>()
  private readonly loadedTranscriptKeys = new Set<string>()
  private readonly runtimeByWorkspace = new Map<string, RuntimeSnapshot>()
  private readonly stateListeners = new Set<(s: DesktopAppState) => void>()
  private readonly transcriptListeners = new Set<(t: SelectedTranscriptRecord | null) => void>()
  private initPromise: Promise<void> | undefined

  constructor() {
    const root = app.getPath('userData')
    this.dataDir = join(root, 'pi-gui-data')
    const catalogFilePath = join(this.dataDir, 'catalogs.json')
    this.driver = createPiSdkDriver({ catalogFilePath })
  }

  async ensureDataDir(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
  }

  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.ensureDataDir().then(async () => {
        await this.refreshState({ clearLastError: true })
      })
    }
    return this.initPromise
  }

  private emit(): void {
    const snapshot = structuredClone(this.state)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.PI_STATE_CHANGED, snapshot)
      }
    }
    for (const l of this.stateListeners) {
      l(snapshot)
    }
  }

  private publishSelectedTranscript(): void {
    const payload = this.buildSelectedTranscriptRecord()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.PI_SELECTED_TRANSCRIPT_CHANGED, payload)
      }
    }
    for (const l of this.transcriptListeners) {
      l(payload)
    }
  }

  private buildSelectedTranscriptRecord(): SelectedTranscriptRecord | null {
    const { selectedWorkspaceId: wsId, selectedSessionId: sessId } = this.state
    if (!wsId || !sessId) return null
    const ref: SessionRef = { workspaceId: wsId, sessionId: sessId }
    const key = sessionKey(ref)
    const transcript = this.transcriptCache.get(key) ?? []
    return { workspaceId: wsId, sessionId: sessId, transcript }
  }

  subscribeState(listener: (s: DesktopAppState) => void): () => void {
    this.stateListeners.add(listener)
    void this.getState().then(listener).catch(() => undefined)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  subscribeTranscript(listener: (t: SelectedTranscriptRecord | null) => void): () => void {
    this.transcriptListeners.add(listener)
    void this.getSelectedTranscript().then(listener).catch(() => undefined)
    return () => {
      this.transcriptListeners.delete(listener)
    }
  }

  async getState(): Promise<DesktopAppState> {
    await this.initialize()
    return structuredClone(this.state)
  }

  async getSelectedTranscript(): Promise<SelectedTranscriptRecord | null> {
    await this.initialize()
    return this.buildSelectedTranscriptRecord()
  }

  private timelineMaps(): TimelineRuntimeState {
    return {
      runMetricsBySession: this.runMetricsBySession,
      runningSinceBySession: this.runningSinceBySession,
      activeAssistantMessageBySession: this.activeAssistantMessageBySession,
      activeWorkingActivityBySession: this.activeWorkingActivityBySession,
    }
  }

  private applyExtensionCompatibilityIssue(
    event: Extract<SessionDriverEvent, { type: 'extensionCompatibilityIssue' }>,
  ): void {
    const wsId = event.sessionRef.workspaceId
    const prev = this.state.extensionCommandCompatibilityByWorkspace[wsId] ?? []
    const issue = event.issue
    const commandName = commandNameFromCompatibilityIssue(issue)
    const record: ExtensionCommandCompatibilityRecord = {
      commandName,
      extensionPath: issue.extensionPath ?? '',
      status: 'terminal-only',
      message: issue.message,
      capability: issue.capability,
      updatedAt: event.timestamp,
    }
    const filtered = prev.filter(
      (r) => !(r.extensionPath === record.extensionPath && r.commandName === record.commandName),
    )
    this.state = {
      ...this.state,
      extensionCommandCompatibilityByWorkspace: {
        ...this.state.extensionCommandCompatibilityByWorkspace,
        [wsId]: [...filtered, record],
      },
      revision: this.state.revision + 1,
    }
  }

  /** Pi SDK updates sessionCommands after extension bind and after runs — keep slash menu in sync. */
  private refreshSessionCommandsForRef(sessionRef: SessionRef): void {
    void this.driver
      .getSessionCommands(sessionRef)
      .then((cmds) => {
        if (
          this.state.selectedWorkspaceId !== sessionRef.workspaceId ||
          this.state.selectedSessionId !== sessionRef.sessionId
        ) {
          return
        }
        this.state = {
          ...this.state,
          sessionCommandsBySession: {
            ...this.state.sessionCommandsBySession,
            [sessionRef.sessionId]: [...cmds],
          },
          revision: this.state.revision + 1,
        }
        this.emit()
      })
      .catch((e) => {
        console.warn('[constell-pi] getSessionCommands failed', e)
      })
  }

  private async handleSessionEvent(event: SessionDriverEvent): Promise<void> {
    if (event.type === 'extensionCompatibilityIssue') {
      this.applyExtensionCompatibilityIssue(event)
      this.emit()
      return
    }

    const key = sessionKey(event.sessionRef)
    switch (event.type) {
      case 'assistantDelta':
        appendAssistantDelta(
          this.transcriptCache,
          this.activeAssistantMessageBySession,
          event.sessionRef,
          event.text,
        )
        break
      case 'sessionOpened':
      case 'sessionUpdated':
      case 'runCompleted':
        if (event.snapshot.config) {
          this.sessionConfigBySession.set(key, event.snapshot.config)
        }
        break
      default:
        break
    }

    applyTimelineEvent(this.transcriptCache, event, this.timelineMaps())

    this.state = applySessionEventState(
      this.state,
      event,
      this.transcriptCache,
      this.runningSinceBySession,
      this.lastViewedAtBySession,
    )

    if (event.type === 'runFailed') {
      this.state = { ...this.state, lastError: event.error.message, revision: this.state.revision + 1 }
    }

    if (event.type === 'hostUiRequest') {
      const snap = this.driver.getSessionExtensionUiSnapshot(event.sessionRef)
      this.state = {
        ...this.state,
        sessionExtensionUiBySession: {
          ...this.state.sessionExtensionUiBySession,
          [event.sessionRef.sessionId]: mapPiExtensionUiSnapshot(snap),
        },
        revision: this.state.revision + 1,
      }
    }

    this.emit()
    this.publishSelectedTranscript()

    if (event.type === 'sessionOpened' || event.type === 'sessionUpdated' || event.type === 'runCompleted') {
      this.refreshSessionCommandsForRef(event.sessionRef)
    }
  }

  private async ensureSessionSubscribed(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef)
    if (this.sessionSubscriptions.has(key)) return
    const unsub = this.driver.subscribe(sessionRef, (ev) => {
      void this.handleSessionEvent(ev)
    })
    this.sessionSubscriptions.set(key, unsub)
  }

  private async ensureTranscriptLoaded(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef)
    if (this.loadedTranscriptKeys.has(key)) return
    const rows = await this.driver.getTranscript(sessionRef)
    this.transcriptCache.set(key, [...rows])
    this.loadedTranscriptKeys.add(key)
  }

  private async ensureRuntime(workspaceId: string, path: string, displayName: string): Promise<void> {
    try {
      // Always refresh so auth.json / models / enabled-model merges match the CLI (cached snapshot was stale).
      const snap = await this.driver.runtimeSupervisor.refreshRuntime({
        workspaceId,
        path,
        displayName,
      })
      this.runtimeByWorkspace.set(workspaceId, snap)
    } catch (e) {
      console.warn('[constell-pi] runtime snapshot failed', e)
    }
  }

  async refreshState(options: {
    selectedWorkspaceId?: string
    selectedSessionId?: string
    composerDraft?: string
    clearLastError?: boolean
  } = {}): Promise<DesktopAppState> {
    const [wsSnap, sessSnap] = await Promise.all([
      this.driver.listWorkspaces(),
      this.driver.listSessions(),
    ])

    const selectedWorkspaceId = resolveSelectedWorkspaceIdFromCatalog(
      options.selectedWorkspaceId ?? this.state.selectedWorkspaceId,
      wsSnap.workspaces,
    )
    const selectedSessionId = resolveSelectedSessionIdFromCatalog(
      selectedWorkspaceId,
      options.selectedSessionId ?? this.state.selectedSessionId,
      sessSnap.sessions,
    )

    if (selectedWorkspaceId && selectedSessionId) {
      const sessionRef = { workspaceId: selectedWorkspaceId, sessionId: selectedSessionId }
      await this.ensureTranscriptLoaded(sessionRef)
      await this.driver.openSession(sessionRef)
      await this.ensureSessionSubscribed(sessionRef)
      const ws = wsSnap.workspaces.find((w) => w.workspaceId === selectedWorkspaceId)
      if (ws) {
        await this.ensureRuntime(ws.workspaceId, ws.path, ws.displayName)
      }
    }

    const workspaces = buildWorkspaceRecords(
      wsSnap.workspaces,
      [],
      sessSnap.sessions,
      this.transcriptCache,
      this.runningSinceBySession,
      this.sessionConfigBySession,
      this.lastViewedAtBySession,
    )
    const worktreesByWorkspace = buildWorktreeRecords(wsSnap.workspaces, [])

    const composerDraft =
      options.composerDraft !== undefined
        ? options.composerDraft
        : this.state.composerDraft

    let sessionCommandsBySession = { ...this.state.sessionCommandsBySession }
    let sessionExtensionUiBySession = { ...this.state.sessionExtensionUiBySession }
    if (selectedWorkspaceId && selectedSessionId) {
      const sessionRef = { workspaceId: selectedWorkspaceId, sessionId: selectedSessionId }
      try {
        const cmds = await this.driver.getSessionCommands(sessionRef)
        sessionCommandsBySession = {
          ...sessionCommandsBySession,
          [selectedSessionId]: [...cmds],
        }
      } catch (e) {
        console.warn('[constell-pi] getSessionCommands in refreshState failed', e)
      }
      try {
        const ext = mapPiExtensionUiSnapshot(this.driver.getSessionExtensionUiSnapshot(sessionRef))
        sessionExtensionUiBySession = {
          ...sessionExtensionUiBySession,
          [selectedSessionId]: ext,
        }
      } catch (e) {
        console.warn('[constell-pi] getSessionExtensionUiSnapshot in refreshState failed', e)
      }
    }

    this.state = {
      ...this.state,
      workspaces,
      worktreesByWorkspace,
      selectedWorkspaceId,
      selectedSessionId,
      composerDraft,
      runtimeByWorkspace: mapToRecord(this.runtimeByWorkspace),
      sessionCommandsBySession,
      sessionExtensionUiBySession,
      extensionCommandCompatibilityByWorkspace: this.state.extensionCommandCompatibilityByWorkspace,
      lastError: options.clearLastError ? undefined : this.state.lastError,
      revision: this.state.revision + 1,
    }
    this.emit()
    this.publishSelectedTranscript()
    return structuredClone(this.state)
  }

  async syncWorkspace(path: string, displayName?: string): Promise<DesktopAppState> {
    await this.initialize()
    await this.driver.syncWorkspace(path, displayName)
    return this.refreshState({})
  }

  async selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    await this.initialize()
    return this.refreshState({
      selectedWorkspaceId: target.workspaceId,
      selectedSessionId: target.sessionId,
    })
  }

  async createSession(input: { workspaceId: string; title?: string }): Promise<DesktopAppState> {
    await this.initialize()
    const wsSnap = await this.driver.listWorkspaces()
    const entry = wsSnap.workspaces.find((w) => w.workspaceId === input.workspaceId)
    if (!entry) {
      throw new Error('Unknown workspace')
    }
    const workspaceRef = {
      workspaceId: entry.workspaceId,
      path: entry.path,
      displayName: entry.displayName,
    }
    const snapshot = await this.driver.createSession(workspaceRef, { title: input.title })
    const sessionId = snapshot.ref.sessionId
    return this.refreshState({
      selectedWorkspaceId: input.workspaceId,
      selectedSessionId: sessionId,
    })
  }

  async submitComposer(text: string): Promise<DesktopAppState> {
    await this.initialize()
    const wsId = this.state.selectedWorkspaceId
    const sessId = this.state.selectedSessionId
    if (!wsId || !sessId) throw new Error('No session selected')
    const sessionRef = toSessionRef({ workspaceId: wsId, sessionId: sessId })
    const trimmed = text.trim()
    const composerAttachments = cloneComposerAttachments([...this.state.composerAttachments])
    if (!trimmed && composerAttachments.length === 0) {
      return structuredClone(this.state)
    }

    const transcriptAtts = toTranscriptAttachments(composerAttachments)
    appendUserMessage(
      this.transcriptCache,
      sessionRef,
      trimmed,
      transcriptAtts.length > 0 ? transcriptAtts : [],
    )

    const sessionAtts = toSessionAttachments(composerAttachments)

    this.state = {
      ...this.state,
      composerDraft: '',
      composerAttachments: [],
      lastError: undefined,
      revision: this.state.revision + 1,
    }
    this.emit()
    this.publishSelectedTranscript()

    const e2eStub = process.env.CONSTELLAGENT_PI_E2E_STUB === '1'
    if (!e2eStub) {
      void this.driver
        .sendUserMessage(sessionRef, {
          text: trimmed,
          ...(sessionAtts.length > 0 ? { attachments: sessionAtts } : {}),
        })
        .catch((e) => {
          const message = e instanceof Error ? e.message : String(e)
          this.state = {
            ...this.state,
            lastError: message,
            revision: this.state.revision + 1,
          }
          this.emit()
        })
    }

    return structuredClone(this.state)
  }

  async setComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<DesktopAppState> {
    await this.initialize()
    const normalized = cloneComposerAttachments([...attachments])
    this.state = {
      ...this.state,
      composerAttachments: normalized,
      revision: this.state.revision + 1,
    }
    this.emit()
    return structuredClone(this.state)
  }

  async removeComposerAttachment(attachmentId: string): Promise<DesktopAppState> {
    await this.initialize()
    this.state = {
      ...this.state,
      composerAttachments: this.state.composerAttachments.filter((a) => a.id !== attachmentId),
      revision: this.state.revision + 1,
    }
    this.emit()
    return structuredClone(this.state)
  }

  async updateComposerDraft(draft: string): Promise<DesktopAppState> {
    await this.initialize()
    this.state = { ...this.state, composerDraft: draft, revision: this.state.revision + 1 }
    this.emit()
    return structuredClone(this.state)
  }

  async cancelCurrentRun(): Promise<DesktopAppState> {
    await this.initialize()
    const wsId = this.state.selectedWorkspaceId
    const sessId = this.state.selectedSessionId
    if (!wsId || !sessId) return structuredClone(this.state)
    const sessionRef = toSessionRef({ workspaceId: wsId, sessionId: sessId })
    await this.driver.cancelCurrentRun(sessionRef)
    return this.refreshState({})
  }

  async setSessionModel(selection: { provider: string; modelId: string }): Promise<DesktopAppState> {
    await this.initialize()
    const wsId = this.state.selectedWorkspaceId
    const sessId = this.state.selectedSessionId
    if (!wsId || !sessId) throw new Error('No session selected')
    const sessionRef = toSessionRef({ workspaceId: wsId, sessionId: sessId })
    await this.driver.setSessionModel(sessionRef, selection)
    return this.refreshState({})
  }

  async setSessionThinkingLevel(thinkingLevel: string): Promise<DesktopAppState> {
    await this.initialize()
    const wsId = this.state.selectedWorkspaceId
    const sessId = this.state.selectedSessionId
    if (!wsId || !sessId) throw new Error('No session selected')
    const sessionRef = toSessionRef({ workspaceId: wsId, sessionId: sessId })
    await this.driver.setSessionThinkingLevel(sessionRef, thinkingLevel)
    return this.refreshState({})
  }

  /** Synchronous read from the in-memory `AgentSession` for the context ring. */
  getContextUsageSnapshot(sessionRef: SessionRef): PiContextUsageSnapshot | null {
    return this.driver.getContextUsageSnapshot(sessionRef)
  }

  async respondToHostUi(response: HostUiResponse): Promise<DesktopAppState> {
    await this.initialize()
    const wsId = this.state.selectedWorkspaceId
    const sessId = this.state.selectedSessionId
    if (!wsId || !sessId) {
      throw new Error('No Pi session selected')
    }
    const sessionRef: SessionRef = { workspaceId: wsId, sessionId: sessId }
    await this.driver.respondToHostUiRequest(sessionRef, response)
    const snap = mapPiExtensionUiSnapshot(this.driver.getSessionExtensionUiSnapshot(sessionRef))
    this.state = {
      ...this.state,
      sessionExtensionUiBySession: {
        ...this.state.sessionExtensionUiBySession,
        [sessId]: snap,
      },
      revision: this.state.revision + 1,
    }
    this.emit()
    return structuredClone(this.state)
  }

  async sendExtensionTuiInput(data: string): Promise<DesktopAppState> {
    await this.initialize()
    const wsId = this.state.selectedWorkspaceId
    const sessId = this.state.selectedSessionId
    if (!wsId || !sessId) {
      return structuredClone(this.state)
    }
    this.driver.deliverExtensionTuiInput({ workspaceId: wsId, sessionId: sessId }, data)
    return structuredClone(this.state)
  }
}

let hostSingleton: ConstellPiHost | undefined

export function getConstellPiHost(): ConstellPiHost {
  if (!hostSingleton) {
    hostSingleton = new ConstellPiHost()
  }
  return hostSingleton
}
