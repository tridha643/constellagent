import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'
import type { RuntimeSnapshot } from '@pi-gui/session-driver/runtime-types'
import {
  extractFilesFromDataTransfer,
  extractImageFilesFromClipboardData,
  hasFilesInDataTransfer,
  readComposerAttachmentsFromFiles,
} from '../../pi-gui/composer-attachments'
import { ComposerPanel } from '../../pi-gui/composer-panel'
import { nextThinkingLevel } from '../../pi-gui/composer-commands'
import { ConversationTimeline } from '../../pi-gui/conversation-timeline'
import { useComposerSlash } from '../../pi-gui/hooks/use-composer-slash'
import { useThreadSearch } from '../../pi-gui/hooks/use-thread-search'
import {
  buildExtensionDockModel,
  ExtensionDialog,
  ExtensionTuiOverlay,
  hasExtensionDockContent,
} from '../../pi-gui/extension-session-ui'
import { deriveModelOnboardingState } from '../../pi-gui/model-onboarding'
import { PiLiveToolActivity } from '../../pi-gui/pi-live-tool-activity'
import { PiThinkingStrip } from '../../pi-gui/pi-thinking-strip'
import { getLiveAssistantStreamPreview } from '../../pi-gui/transcript-stream'
import type { SessionRef } from '@pi-gui/session-driver'
import type { DesktopAppState, SelectedTranscriptRecord } from '@shared/pi/pi-desktop-state'
import { getSelectedSession, getSelectedWorkspace } from '@shared/pi/pi-desktop-state'
import type { TranscriptMessage } from '@shared/pi/timeline-types'
import '../../pi-gui/pi-gui-thread.css'
import '../../pi-gui/pi-gui-constellagent-bridge.css'
import { useAppStore } from '../../store/app-store'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import { pathsEqualOrAlias } from '../../../shared/agent-plan-path'
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary'
import styles from './PiThreadPanel.module.css'

const PI_SYNC_TTL_MS = 1500
const transcriptCache = new Map<string, TranscriptMessage[]>()
const lastPiSyncAtByPath = new Map<string, number>()

function transcriptCacheKey(worktreePath: string, sessionId: string): string {
  return `${worktreePath}\0${sessionId}`
}

function isNearBottom(pane: HTMLElement, thresholdPx = 120): boolean {
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= thresholdPx
}

export interface PiThreadPanelProps {
  worktreePath: string
  workspaceLabel?: string
  active: boolean
  /** When set, this tab owns this Pi session (multi-chat per worktree). */
  boundSessionId?: string
  /** Constellagent tab id for updating session binding (new chat / switcher). */
  piThreadTabId?: string
}

/**
 * Pi-gui thread + composer stack backed by main-process PiSdkDriver (`window.api.pi`).
 */
export function PiThreadPanel(props: PiThreadPanelProps) {
  const [boundaryKey, setBoundaryKey] = useState(0)
  return (
    <ErrorBoundary
      key={boundaryKey}
      fallback={
        <div className={`${styles.shell} pi-gui-scope`}>
          <div className={styles.toolbar}>
            <span className={styles.hint}>PI Chat</span>
          </div>
          <div className={styles.errorBox}>
            <span>Something went wrong in this panel.</span>
            <button type="button" className={styles.toolbarBtn} onClick={() => setBoundaryKey((k) => k + 1)}>
              Reload panel
            </button>
          </div>
        </div>
      }
    >
      <PiThreadPanelInner {...props} />
    </ErrorBoundary>
  )
}

function PiThreadPanelInner({ worktreePath, workspaceLabel, active, boundSessionId, piThreadTabId }: PiThreadPanelProps) {
  const [state, setState] = useState<DesktopAppState | null>(null)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionMissing, setSessionMissing] = useState(false)
  const [dockExpandedBySession, setDockExpandedBySession] = useState<Record<string, boolean>>({})
  const timelinePaneRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const attachmentPickerRef = useRef<HTMLInputElement | null>(null)
  const pinnedToBottomRef = useRef(true)
  const scrollPinRafRef = useRef<number | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const threadSearch = useThreadSearch(timelinePaneRef)

  const schedulePinToBottomScroll = useCallback(() => {
    if (!pinnedToBottomRef.current) return
    if (scrollPinRafRef.current != null) return
    scrollPinRafRef.current = requestAnimationFrame(() => {
      scrollPinRafRef.current = null
      const pane = timelinePaneRef.current
      if (pane && pinnedToBottomRef.current) {
        pane.scrollTop = pane.scrollHeight
      }
    })
  }, [])

  useEffect(
    () => () => {
      if (scrollPinRafRef.current != null) {
        cancelAnimationFrame(scrollPinRafRef.current)
        scrollPinRafRef.current = null
      }
    },
    [],
  )
  const blockTranscriptIpcRef = useRef(false)
  const setPiThreadSessionBinding = useAppStore((s) => s.setPiThreadSessionBinding)

  useEffect(() => {
    const offState = window.api.pi.onStateChanged((s) => {
      setState(s as DesktopAppState)
    })
    const offTr = window.api.pi.onSelectedTranscriptChanged((p) => {
      if (blockTranscriptIpcRef.current) return
      setTranscript([...((p as SelectedTranscriptRecord | null)?.transcript ?? [])])
    })
    return () => {
      offState()
      offTr()
    }
  }, [])

  const syncAndSelect = useCallback(async () => {
    setError(null)
    setSessionMissing(false)
    blockTranscriptIpcRef.current = false

    if (boundSessionId) {
      const ck = transcriptCacheKey(worktreePath, boundSessionId)
      const cached = transcriptCache.get(ck)
      if (cached?.length) {
        setTranscript([...cached])
      }
    }

    try {
      const now = Date.now()
      const last = lastPiSyncAtByPath.get(worktreePath) ?? 0
      let s: DesktopAppState
      if (now - last < PI_SYNC_TTL_MS) {
        s = (await window.api.pi.getState()) as DesktopAppState
      } else {
        lastPiSyncAtByPath.set(worktreePath, now)
        s = (await window.api.pi.syncWorkspace(worktreePath, workspaceLabel)) as DesktopAppState
      }
      setState(s)

      const ws =
        s.workspaces.find((w) => pathsEqualOrAlias(w.path, worktreePath)) ??
        s.workspaces.find((w) => worktreePath.startsWith(w.path)) ??
        s.workspaces.find((w) => w.path.startsWith(worktreePath)) ??
        s.workspaces[0]
      if (!ws) {
        setError('No Pi workspace after sync')
        return
      }

      if (boundSessionId) {
        const exists = ws.sessions.some((x) => x.id === boundSessionId)
        if (!exists) {
          blockTranscriptIpcRef.current = true
          setSessionMissing(true)
          setError('This chat is no longer available (session removed).')
          const ck = transcriptCacheKey(worktreePath, boundSessionId)
          if (transcriptCache.has(ck)) {
            setTranscript([...transcriptCache.get(ck)!])
          } else {
            setTranscript([])
          }
          return
        }
        await window.api.pi.selectSession({ workspaceId: ws.id, sessionId: boundSessionId })
      } else if (!ws.sessions.length) {
        await window.api.pi.createSession({ workspaceId: ws.id })
      } else {
        const lastSess = ws.sessions[ws.sessions.length - 1]
        await window.api.pi.selectSession({ workspaceId: ws.id, sessionId: lastSess.id })
      }

      const tr = (await window.api.pi.getSelectedTranscript()) as SelectedTranscriptRecord | null
      const nextTr = tr?.transcript ? [...tr.transcript] : []
      setTranscript(nextTr)
      const fresh = (await window.api.pi.getState()) as DesktopAppState
      setState(fresh)
      const selId = fresh.selectedSessionId
      if (selId) {
        transcriptCache.set(transcriptCacheKey(worktreePath, selId), nextTr)
      }
      setDraft(fresh.composerDraft ?? '')
      pinnedToBottomRef.current = true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [worktreePath, workspaceLabel, boundSessionId])

  useEffect(() => {
    if (!active) return
    void syncAndSelect()
  }, [active, syncAndSelect])

  const selectedWorkspace = useMemo(() => (state ? getSelectedWorkspace(state) : undefined), [state])
  const selectedSession = useMemo(() => (state ? getSelectedSession(state) : undefined), [state])
  const sessionRunning = Boolean(selectedSession?.status === 'running')
  const liveAssistantPreview = useMemo(
    () => getLiveAssistantStreamPreview(transcript, sessionRunning),
    [transcript, sessionRunning],
  )

  const resolvedPiWorkspace = useMemo(() => {
    if (!state) return undefined
    return (
      state.workspaces.find((w) => pathsEqualOrAlias(w.path, worktreePath)) ??
      state.workspaces.find((w) => worktreePath.startsWith(w.path)) ??
      state.workspaces.find((w) => w.path.startsWith(worktreePath))
    )
  }, [state, worktreePath])

  useEffect(() => {
    if (!active || !selectedSession || sessionMissing) return
    const ck = transcriptCacheKey(worktreePath, selectedSession.id)
    transcriptCache.set(ck, transcript)
  }, [active, worktreePath, selectedSession?.id, transcript, sessionMissing])

  const runtime: RuntimeSnapshot | undefined = selectedWorkspace
    ? state?.runtimeByWorkspace[selectedWorkspace.id]
    : undefined

  const piContextSessionRef: SessionRef | undefined =
    selectedWorkspace && selectedSession
      ? { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id }
      : undefined

  const setDraftPersist = useCallback((action: SetStateAction<string>) => {
    setDraft((prev) => {
      const next = typeof action === 'function' ? action(prev) : action
      void window.api.pi.updateComposerDraft(next)
      return next
    })
  }, [])

  const cycleComposerReasoningLevel = useCallback(() => {
    if (!selectedSession || selectedSession.status === 'running') return
    const next = nextThinkingLevel(selectedSession.config?.thinkingLevel)
    setError(null)
    void window.api.pi
      .setSessionThinkingLevel(next)
      .then((s) => setState(s as DesktopAppState))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [selectedSession])

  const reasoningHotkey = useMemo(
    () =>
      selectedSession
        ? { disabled: selectedSession.status === 'running', onCycle: cycleComposerReasoningLevel }
        : undefined,
    [selectedSession, cycleComposerReasoningLevel],
  )

  const slash = useComposerSlash({
    draft,
    setDraft: setDraftPersist,
    composerRef,
    runtime,
    sessionCommands: state?.sessionCommandsBySession[selectedSession?.id ?? ''] ?? [],
    compatibilityRecords: selectedWorkspace
      ? (state?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? [])
      : [],
    onHostImmediate: (cmd) => {
      if (cmd.kind === 'settings') {
        useAppStore.setState({ settingsOpen: true, automationsOpen: false })
      }
    },
    reasoningHotkey,
  })

  useEffect(() => {
    if (!state || !selectedSession) return
    const next = state.composerDraft ?? ''
    setDraft((prev) => (prev === next ? prev : next))
  }, [state?.composerDraft, state?.revision, selectedSession?.id])

  const extensionUi = selectedSession
    ? state?.sessionExtensionUiBySession[selectedSession.id]
    : undefined
  const extensionDock = useMemo(
    () => (hasExtensionDockContent(extensionUi) ? buildExtensionDockModel(extensionUi) : undefined),
    [extensionUi],
  )

  const topExtensionDialog = extensionUi?.pendingDialogs?.[0]

  const modelOnboardingBase = useMemo(
    () =>
      deriveModelOnboardingState(runtime, {
        provider: selectedSession?.config?.provider,
        modelId: selectedSession?.config?.modelId,
      }),
    [runtime, selectedSession?.config?.provider, selectedSession?.config?.modelId],
  )

  const modelOnboarding = useMemo(
    () => ({
      ...modelOnboardingBase,
      requiresModelSelection: false,
    }),
    [modelOnboardingBase],
  )

  const handleTimelineScroll = useCallback(() => {
    const pane = timelinePaneRef.current
    if (!pane) return
    const near = isNearBottom(pane)
    pinnedToBottomRef.current = near
    setShowJumpToLatest(!near)
  }, [])

  const handleJumpToLatest = useCallback(() => {
    const pane = timelinePaneRef.current
    if (!pane) return
    pane.scrollTo({ top: pane.scrollHeight, behavior: getPreferredScrollBehavior() })
    pinnedToBottomRef.current = true
    setShowJumpToLatest(false)
  }, [])

  const handleLiveToolLayout = useCallback(() => {
    schedulePinToBottomScroll()
  }, [schedulePinToBottomScroll])

  useLayoutEffect(() => {
    if (!active) return
    schedulePinToBottomScroll()
  }, [transcript, active, schedulePinToBottomScroll])

  const dockExpanded = selectedSession ? Boolean(dockExpandedBySession[selectedSession.id]) : false

  const mergeAttachments = useCallback(
    async (newOnes: Awaited<ReturnType<typeof readComposerAttachmentsFromFiles>>) => {
      if (newOnes.length === 0) return
      setError(null)
      const existing = state?.composerAttachments ?? []
      await window.api.pi.setComposerAttachments([...existing, ...newOnes])
    },
    [state?.composerAttachments],
  )

  const onSubmit = useCallback(async () => {
    const text = draft.trim()
    const hasAttachments = (state?.composerAttachments?.length ?? 0) > 0
    if (!text && !hasAttachments) return
    setError(null)
    pinnedToBottomRef.current = true
    setDraftPersist('')
    try {
      await window.api.pi.submitComposer(text)
    } catch (e) {
      setDraftPersist(text)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [draft, state?.composerAttachments?.length, setDraftPersist])

  const onCancel = async () => {
    try {
      await window.api.pi.cancelCurrentRun()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runningLabel = 'Working…'

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        const hasAtt = (state?.composerAttachments?.length ?? 0) > 0
        if (draft.trim() || hasAtt) void onSubmit()
      }
    },
    [draft, state?.composerAttachments?.length, onSubmit],
  )

  const composerKeyDown = useMemo(
    () => slash.wrapComposerKeyDown(handleComposerKeyDown),
    [slash, handleComposerKeyDown],
  )

  const handleComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    void readComposerAttachmentsFromFiles(files).then((attachments) => {
      void mergeAttachments(attachments)
    })
  }

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    const files = extractFilesFromDataTransfer(event.dataTransfer)
    void readComposerAttachmentsFromFiles(files).then((attachments) => {
      void mergeAttachments(attachments)
    })
  }

  const handleAttachmentFilesChosen = async (list: FileList | null) => {
    if (!list?.length) return
    const attachments = await readComposerAttachmentsFromFiles(Array.from(list))
    if (attachmentPickerRef.current) attachmentPickerRef.current.value = ''
    await mergeAttachments(attachments)
  }

  const handleStartNewChat = useCallback(async () => {
    const ws = resolvedPiWorkspace
    if (!ws || !piThreadTabId) {
      void syncAndSelect()
      return
    }
    setError(null)
    setSessionMissing(false)
    blockTranscriptIpcRef.current = false
    try {
      const nextState = (await window.api.pi.createSession({ workspaceId: ws.id })) as DesktopAppState
      const sid = nextState.selectedSessionId
      const updatedWs = nextState.workspaces.find((w) => w.id === ws.id)
      const sess = updatedWs?.sessions.find((x) => x.id === sid)
      const title = sess?.title?.trim() || 'PI Chat'
      setPiThreadSessionBinding(piThreadTabId, sid, title)
      setState(nextState)
      await window.api.pi.selectSession({ workspaceId: ws.id, sessionId: sid })
      const tr = (await window.api.pi.getSelectedTranscript()) as SelectedTranscriptRecord | null
      const nextTr = tr?.transcript ? [...tr.transcript] : []
      setTranscript(nextTr)
      transcriptCache.set(transcriptCacheKey(worktreePath, sid), nextTr)
      setDraft(((await window.api.pi.getState()) as DesktopAppState).composerDraft ?? '')
      pinnedToBottomRef.current = true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [resolvedPiWorkspace, piThreadTabId, setPiThreadSessionBinding, syncAndSelect, worktreePath])

  const onSessionSwitcherChange = useCallback(
    async (sessionId: string) => {
      const ws = resolvedPiWorkspace
      if (!ws || !sessionId) return
      const sess = ws.sessions.find((x) => x.id === sessionId)
      if (piThreadTabId) {
        setPiThreadSessionBinding(piThreadTabId, sessionId, sess?.title?.trim() || undefined)
      }
      setError(null)
      setSessionMissing(false)
      blockTranscriptIpcRef.current = false
      try {
        await window.api.pi.selectSession({ workspaceId: ws.id, sessionId })
        const tr = (await window.api.pi.getSelectedTranscript()) as SelectedTranscriptRecord | null
        const nextTr = tr?.transcript ? [...(tr.transcript ?? [])] : []
        setTranscript(nextTr)
        transcriptCache.set(transcriptCacheKey(worktreePath, sessionId), nextTr)
        const fresh = (await window.api.pi.getState()) as DesktopAppState
        setState(fresh)
        setDraft(fresh.composerDraft ?? '')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [resolvedPiWorkspace, piThreadTabId, setPiThreadSessionBinding, worktreePath],
  )

  if (!active) {
    return <div className={styles.hidden} aria-hidden />
  }

  if (sessionMissing) {
    return (
      <div className={`${styles.shell} pi-gui-scope`}>
        <div className={styles.toolbar}>
          <span className={styles.hint}>PI Chat · {worktreePath}</span>
          {error ? <span className={styles.warn}>{error}</span> : null}
        </div>
        <div className={styles.errorBox}>
          <p>{error ?? 'Session unavailable.'}</p>
          {piThreadTabId ? (
            <button type="button" className={styles.toolbarBtn} onClick={() => void handleStartNewChat()}>
              Start new chat
            </button>
          ) : null}
          <button type="button" className={styles.retryLink} onClick={() => void syncAndSelect()}>
            Retry sync
          </button>
        </div>
        {transcript.length > 0 ? (
          <section className="conversation conversation--thread" style={{ opacity: 0.85, flex: 1, minHeight: 0 }}>
            <ConversationTimeline
              transcript={transcript}
              isTranscriptLoading={false}
              timelinePaneRef={timelinePaneRef}
              onTimelineScroll={handleTimelineScroll}
              threadSearch={{
                ...threadSearch,
                search: threadSearch.search,
                goToMatch: threadSearch.goToMatch,
              }}
              showJumpToLatest={showJumpToLatest}
              onJumpToLatest={handleJumpToLatest}
              onContentHeightChange={() => {}}
              sessionRunning={false}
              liveToolActivityFooter={null}
            />
          </section>
        ) : null}
      </div>
    )
  }

  if (!selectedSession) {
    return (
      <div className={`${styles.shell} pi-gui-scope`}>
        <div className={styles.toolbar}>
          <span className={styles.hint}>PI Chat · {worktreePath}</span>
          {error ? <span className={styles.warn}>{error}</span> : null}
          {error ? (
            <button type="button" className={styles.retryLink} onClick={() => void syncAndSelect()}>
              Retry
            </button>
          ) : null}
        </div>
        <div className="timeline-empty" style={{ padding: 16 }}>
          {error ?? 'Loading session…'}
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.shell} pi-gui-scope`}>
      {topExtensionDialog ? (
        <ExtensionDialog
          dialog={topExtensionDialog}
          onRespond={(response) => {
            void window.api.pi.respondHostUi(response).then((s) => setState(s as DesktopAppState))
          }}
        />
      ) : null}
      {!topExtensionDialog && extensionUi?.tuiCustom ? (
        <ExtensionTuiOverlay
          model={extensionUi.tuiCustom}
          onInputData={(data) => {
            void window.api.pi.sendExtensionTuiInput(data)
          }}
        />
      ) : null}
      <input
        ref={attachmentPickerRef}
        type="file"
        multiple
        className={styles.hiddenFileInput}
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handleAttachmentFilesChosen(e.target.files)}
      />
      <div className={styles.toolbar}>
        <span className={styles.hint}>PI Chat · {worktreePath}</span>
        {resolvedPiWorkspace && resolvedPiWorkspace.sessions.length > 0 ? (
          <select
            className={styles.sessionSelect}
            aria-label="Pi chat session"
            value={selectedSession.id}
            onChange={(e) => void onSessionSwitcherChange(e.target.value)}
          >
            {resolvedPiWorkspace.sessions.map((sess) => (
              <option key={sess.id} value={sess.id}>
                {sess.title || sess.id.slice(0, 8)}
              </option>
            ))}
          </select>
        ) : null}
        {state?.lastError ? <span className={styles.warn}>{state.lastError}</span> : null}
        {error ? <span className={styles.warn}>{error}</span> : null}
        {error || state?.lastError ? (
          <button type="button" className={styles.retryLink} onClick={() => void syncAndSelect()}>
            Retry
          </button>
        ) : null}
      </div>
      <div className={styles.mainColumn}>
        <section className="conversation conversation--thread">
          <ConversationTimeline
            transcript={transcript}
            isTranscriptLoading={false}
            timelinePaneRef={timelinePaneRef}
            onTimelineScroll={handleTimelineScroll}
            threadSearch={{
              ...threadSearch,
              search: threadSearch.search,
              goToMatch: threadSearch.goToMatch,
            }}
            showJumpToLatest={showJumpToLatest}
            onJumpToLatest={handleJumpToLatest}
            onContentHeightChange={schedulePinToBottomScroll}
            sessionRunning={sessionRunning}
            liveToolActivityFooter={
              <PiLiveToolActivity
                transcript={transcript}
                sessionRunning={sessionRunning}
                onLayout={handleLiveToolLayout}
              />
            }
          />
        </section>
        <ComposerPanel
          selectedSession={selectedSession}
          lastError={state?.lastError}
          runtime={runtime}
          piContextSessionRef={piContextSessionRef}
          thinkingSlot={(
            <PiThinkingStrip
              sessionRunning={sessionRunning}
              streamingPreviewText={liveAssistantPreview}
            />
          )}
          composerDraft={draft}
          setComposerDraft={setDraftPersist}
          composerRef={composerRef}
          runningLabel={runningLabel}
          attachments={state?.composerAttachments ?? []}
          queuedMessages={state?.queuedComposerMessages ?? []}
          editingQueuedMessageId={state?.editingQueuedMessageId}
          provider={selectedSession.config?.provider}
          modelId={selectedSession.config?.modelId}
          thinkingLevel={selectedSession.config?.thinkingLevel}
          slashSections={slash.slashSections}
          slashOptions={slash.slashOptions}
          showSlashMenu={slash.showSlashMenu}
          showSlashOptionMenu={slash.showSlashOptionMenu}
          selectedSlashCommand={slash.selectedSlashCommand}
          selectedSlashOption={slash.selectedSlashOption}
          slashOptionEmptyState={slash.slashOptionEmptyState}
          activeSlashCommand={slash.activeSlashCommand}
          activeSlashCommandMeta={slash.activeSlashCommandMeta}
          onClearSlashCommand={slash.onClearSlashCommand}
          onComposerKeyDown={composerKeyDown}
          onComposerSelectionChange={slash.onComposerSelectionChange}
          onComposerPaste={handleComposerPaste}
          onComposerDrop={handleComposerDrop}
          onPickAttachments={() => attachmentPickerRef.current?.click()}
          onRemoveAttachment={(attachmentId) => void window.api.pi.removeComposerAttachment(attachmentId)}
          onEditQueuedMessage={() => {}}
          onCancelQueuedEdit={() => {}}
          onRemoveQueuedMessage={() => {}}
          onSteerQueuedMessage={() => {}}
          onSelectSlashCommand={slash.onSelectSlashCommand}
          onSelectSlashOption={slash.onSelectSlashOption}
          onSetModel={(nextProvider, nextModelId) => {
            setError(null)
            void window.api.pi
              .setSessionModel({ provider: nextProvider, modelId: nextModelId })
              .then((s) => setState(s as DesktopAppState))
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }}
          onSetThinking={(level) => {
            setError(null)
            void window.api.pi
              .setSessionThinkingLevel(level)
              .then((s) => setState(s as DesktopAppState))
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }}
          modelOnboarding={modelOnboarding}
          onOpenModelSettings={() => {
            setError('Open Constellagent settings for model configuration.')
          }}
          onSubmit={() => {
            const hasInput =
              draft.trim().length > 0 || (state?.composerAttachments?.length ?? 0) > 0
            if (selectedSession.status === 'running' && !hasInput) {
              void onCancel()
            } else {
              void onSubmit()
            }
          }}
          showMentionMenu={false}
          mentionOptions={[]}
          selectedMentionIndex={0}
          onSelectMention={() => {}}
          extensionDock={extensionDock}
          extensionDockExpanded={dockExpanded}
          onToggleExtensionDock={() =>
            setDockExpandedBySession((prev) => ({
              ...prev,
              [selectedSession.id]: !prev[selectedSession.id],
            }))
          }
        />
      </div>
    </div>
  )
}
