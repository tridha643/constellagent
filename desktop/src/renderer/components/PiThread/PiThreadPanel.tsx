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
import type { SessionRef } from '@pi-gui/session-driver'
import type { DesktopAppState, SelectedTranscriptRecord } from '@shared/pi/pi-desktop-state'
import { getSelectedSession, getSelectedWorkspace } from '@shared/pi/pi-desktop-state'
import type { TranscriptMessage } from '@shared/pi/timeline-types'
import '../../pi-gui/pi-gui-thread.css'
import '../../pi-gui/pi-gui-constellagent-bridge.css'
import { useAppStore } from '../../store/app-store'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import styles from './PiThreadPanel.module.css'

function isNearBottom(pane: HTMLElement, thresholdPx = 120): boolean {
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= thresholdPx
}

interface Props {
  worktreePath: string
  workspaceLabel?: string
  active: boolean
}

/**
 * Pi-gui thread + composer stack backed by main-process PiSdkDriver (`window.api.pi`).
 */
export function PiThreadPanel({ worktreePath, workspaceLabel, active }: Props) {
  const [state, setState] = useState<DesktopAppState | null>(null)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dockExpandedBySession, setDockExpandedBySession] = useState<Record<string, boolean>>({})
  const timelinePaneRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const attachmentPickerRef = useRef<HTMLInputElement | null>(null)
  const pinnedToBottomRef = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const threadSearch = useThreadSearch(timelinePaneRef)

  useEffect(() => {
    const offState = window.api.pi.onStateChanged((s) => {
      setState(s as DesktopAppState)
    })
    const offTr = window.api.pi.onSelectedTranscriptChanged((p) => {
      setTranscript([...((p as SelectedTranscriptRecord | null)?.transcript ?? [])])
    })
    return () => {
      offState()
      offTr()
    }
  }, [])

  const syncAndSelect = useCallback(async () => {
    setError(null)
    try {
      await window.api.pi.syncWorkspace(worktreePath, workspaceLabel)
      const s = (await window.api.pi.getState()) as DesktopAppState
      setState(s)
      const ws =
        s.workspaces.find((w) => w.path === worktreePath) ??
        s.workspaces.find((w) => worktreePath.startsWith(w.path)) ??
        s.workspaces[0]
      if (!ws) {
        setError('No Pi workspace after sync')
        return
      }
      if (!ws.sessions.length) {
        await window.api.pi.createSession({ workspaceId: ws.id })
      } else {
        const last = ws.sessions[ws.sessions.length - 1]
        await window.api.pi.selectSession({ workspaceId: ws.id, sessionId: last.id })
      }
      const tr = (await window.api.pi.getSelectedTranscript()) as SelectedTranscriptRecord | null
      setTranscript(tr?.transcript ? [...tr.transcript] : [])
      setDraft(((await window.api.pi.getState()) as DesktopAppState).composerDraft ?? '')
      pinnedToBottomRef.current = true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [worktreePath, workspaceLabel])

  useEffect(() => {
    if (!active) return
    void syncAndSelect()
  }, [active, syncAndSelect])

  const selectedWorkspace = useMemo(() => (state ? getSelectedWorkspace(state) : undefined), [state])
  const selectedSession = useMemo(() => (state ? getSelectedSession(state) : undefined), [state])

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
    const key = selectedSession.id
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

  /** Embedded mode: allow send even when runtime models are still loading (parity with prior PTY flow). */
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

  useLayoutEffect(() => {
    if (!active) return
    const pane = timelinePaneRef.current
    if (!pane || !pinnedToBottomRef.current) return
    pane.scrollTop = pane.scrollHeight
  }, [transcript, active])

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

  if (!active) {
    return <div className={styles.hidden} aria-hidden />
  }

  if (!selectedSession) {
    return (
      <div className={`${styles.shell} pi-gui-scope`}>
        <div className={styles.toolbar}>
          <span className={styles.hint}>PI Chat · {worktreePath}</span>
          {error ? <span className={styles.warn}>{error}</span> : null}
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
        {state?.lastError ? <span className={styles.warn}>{state.lastError}</span> : null}
        {error ? <span className={styles.warn}>{error}</span> : null}
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
            onContentHeightChange={() => {
              const pane = timelinePaneRef.current
              if (pane && pinnedToBottomRef.current) {
                pane.scrollTop = pane.scrollHeight
              }
            }}
          />
        </section>
        <ComposerPanel
          selectedSession={selectedSession}
          lastError={state?.lastError}
          runtime={runtime}
          piContextSessionRef={piContextSessionRef}
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
