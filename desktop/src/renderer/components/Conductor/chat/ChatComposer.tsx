import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Plus, X } from 'lucide-react'
import type { AgentProvider, QueuedAgentMessage, QueuedAgentMessageMode } from '../../../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../../../shared/conductor-attachments'
import type { TranscriptMessage } from '../../../../shared/pi/pi-desktop-state'
import type { ConductorSlashCommand } from '../../../../shared/conductor-composer-commands'
import { hasEffortVariants, hasFastVariant, isFastModel } from '../../../../shared/conductor-model-utils'
import { normalizeThinkingLevel, isReasoningEffortActive, type ThinkingLevel } from '../../../../shared/conductor-thinking'
import { ChatModelSelector } from './ChatModelSelector'
import { EffortPill } from './EffortPill'
import { FastToggle } from './FastToggle'
import { ComposerSendIcon, ComposerStopIcon, PlanMapIcon } from './ConductorIcons'
import { ConductorMessageQueue } from './ConductorMessageQueue'
import { ConductorPersonalityMenu } from './ConductorPersonalityMenu'
import { ConductorAtMenu } from './ConductorAtMenu'
import { ComposerFileChip } from './ComposerFileChip'
import {
  ComposerSkillChip,
  createConductorSkillMention,
  type ConductorSkillMention,
} from './ComposerSkillChip'
import { ConductorHashMenu } from './ConductorHashMenu'
import { ConductorSlashMenu } from './ConductorSlashMenu'
import { ConductorSlashNamePrompt } from './ConductorSlashNamePrompt'
import { useConductorComposerAt } from './use-conductor-composer-at'
import { useConductorComposerHash } from './use-conductor-composer-hash'
import { useConductorComposerSlash } from './use-conductor-composer-slash'
import { useAppStore } from '../../../store/app-store'
import {
  createConductorFileMention,
  hasComposerDraftInput,
  serializeComposerTextWithFileMentions,
  shouldBackspaceRemoveLastFileMention,
  type ConductorFileMention,
} from '../../../../shared/composer-at-mention'
import {
  ContextUsageHover,
} from './ContextWindowControl'
import {
  CONDUCTOR_IMAGE_ACCEPT,
  extractImageFilesFromClipboardData,
  extractImageFilesFromDataTransfer,
  hasFilesInDataTransfer,
  mergeConductorAttachments,
  readConductorImageAttachmentsFromFiles,
} from './conductor-attachments'
import styles from '../Conductor.module.css'

export interface ChatComposerHandle {
  setText: (text: string) => void
  focus: () => void
}

export function ChatComposer({
  provider,
  model,
  thinkingLevel,
  plan,
  running,
  disabled,
  queuedMessages,
  transcript,
  onSubmit,
  onCancel,
  onReplaceQueue,
  onSetModel,
  onSetThinkingLevel,
  onToggleFast,
  onSetPlan,
  onHistoryUp,
  composerRef,
  sessionId,
  workspacePath,
  repoPath,
  onSlashAction,
  onPersonalitySelect,
  onNamePromptConfirm,
}: {
  provider: AgentProvider
  model: string
  thinkingLevel: ThinkingLevel
  plan: boolean
  running: boolean
  disabled?: boolean
  queuedMessages: readonly QueuedAgentMessage[]
  transcript: readonly TranscriptMessage[]
  onSubmit: (
    text: string,
    deliverAs?: QueuedAgentMessageMode,
    attachments?: readonly ConductorComposerAttachment[],
  ) => void
  onCancel: () => void
  onReplaceQueue: (messages: readonly QueuedAgentMessage[]) => void
  onSetModel: (provider: AgentProvider, model: string) => void
  onSetThinkingLevel: (level: ThinkingLevel) => void
  onToggleFast: (fast: boolean) => void
  onSetPlan: (plan: boolean) => void
  onHistoryUp: () => void
  composerRef?: React.RefObject<ChatComposerHandle | null>
  sessionId: string | null
  workspacePath: string
  repoPath: string
  onSlashAction: (command: ConductorSlashCommand) => void
  onPersonalitySelect: (value: string) => void
  onNamePromptConfirm: (command: ConductorSlashCommand, value: string) => void
}) {
  const [text, setText] = useState('')
  const [fileMentions, setFileMentions] = useState<ConductorFileMention[]>([])
  const [skillMentions, setSkillMentions] = useState<ConductorSkillMention[]>([])
  const [attachments, setAttachments] = useState<ConductorComposerAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [pickingImages, setPickingImages] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerInnerRef = useRef<HTMLDivElement | null>(null)

  const addSkillMention = useCallback((command: ConductorSlashCommand) => {
    const name = command.command.replace(/^\//, '')
    setSkillMentions((current) => {
      if (current.some((mention) => mention.command === command.command)) {
        return current
      }
      return [
        ...current,
        createConductorSkillMention({
          name,
          command: command.command,
          sourcePath: command.sourcePath,
        }),
      ]
    })
  }, [])

  const {
    slashSections,
    showSlashMenu,
    showPersonalityMenu,
    showNamePromptMenu,
    namePromptVariant,
    selectedSlashCommand,
    optionIndex,
    onSelectSlashCommand,
    onSelectPersonalityOption,
    onConfirmNamePrompt,
    onComposerSelectionChange,
    wrapComposerKeyDown,
    dismissSlashUi,
  } = useConductorComposerSlash({
    text,
    setText,
    composerRef: textareaRef,
    provider,
    model,
    workspacePath,
    onSlashAction,
    onSkillSelect: addSkillMention,
    onPersonalitySelect,
    onNamePromptConfirm,
  })

  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)

  const addFileMention = useCallback((item: { path: string; relativePath: string }) => {
    setFileMentions((current) => {
      if (current.some((mention) => mention.relativePath === item.relativePath)) {
        return current
      }
      return [...current, createConductorFileMention(item)]
    })
  }, [])

  const removeFileMention = useCallback((id: string) => {
    setFileMentions((current) => current.filter((mention) => mention.id !== id))
  }, [])

  const removeSkillMention = useCallback((id: string) => {
    setSkillMentions((current) => current.filter((mention) => mention.id !== id))
  }, [])

  const popLastFileMention = useCallback(() => {
    setFileMentions((current) => (current.length > 0 ? current.slice(0, -1) : current))
  }, [])

  const popLastSkillMention = useCallback(() => {
    setSkillMentions((current) => (current.length > 0 ? current.slice(0, -1) : current))
  }, [])

  const {
    showHashMenu,
    filteredPrs,
    selectedPr,
    loading: hashLoading,
    fetchError: hashFetchError,
    onSelectHashMention,
    onComposerSelectionChange: onHashSelectionChange,
    wrapComposerKeyDown: wrapHashKeyDown,
    dismissHashUi,
  } = useConductorComposerHash({
    text,
    setText,
    composerRef: textareaRef,
    repoPath,
  })

  const {
    showAtMenu,
    atItems,
    selectedAtItem,
    loading: atLoading,
    indexing: atIndexing,
    fetchError: atFetchError,
    onSelectAtMention,
    onComposerSelectionChange: onAtSelectionChange,
    wrapComposerKeyDown: wrapAtKeyDown,
    dismissAtUi,
  } = useConductorComposerAt({
    text,
    setText,
    composerRef: textareaRef,
    workspacePath,
    onAddFileMention: addFileMention,
  })

  const modelLabel = `${provider} · ${model}`
  const showEffort = hasEffortVariants(model, provider)
  const showFast = hasFastVariant(model, provider)
  const fastActive = isFastModel(model)
  const effortLevel = normalizeThinkingLevel(thinkingLevel)
  const reasoningActive = isReasoningEffortActive(effortLevel)
  const runningHint = 'Enter · queue · ⌘↵ · steer · Esc · stop'
  const showFocusHint = !focused && !disabled && !running
  const showRunningHint = running && !focused && !disabled
  const hasInput =
    hasComposerDraftInput(text, fileMentions) || skillMentions.length > 0 || attachments.length > 0
  const textareaPlaceholder =
    attachments.length > 0
      ? 'Describe what you want about the attached image…'
      : 'Ask to make changes, @mention files, reference PRs with #, run /commands'

  const composerPayload = useMemo(() => {
    const messagePayload = serializeComposerTextWithFileMentions(text, fileMentions)
    const skillPayload = skillMentions.map((mention) => mention.command).join(' ')
    return [skillPayload, messagePayload].filter(Boolean).join(' ').trim()
  }, [fileMentions, skillMentions, text])

  const contextQueuedMessages = useMemo(() => {
    if (!editingQueueId) return queuedMessages
    return queuedMessages.map((message) =>
      message.id === editingQueueId
        ? { ...message, text: composerPayload, attachments: [...attachments] }
        : message,
    )
  }, [attachments, composerPayload, editingQueueId, queuedMessages])
  const contextDraftText = editingQueueId ? '' : composerPayload
  const contextDraftAttachments = editingQueueId ? [] : attachments

  const composerInnerClass = [
    styles.composerInner,
    plan ? styles.composerInnerPlan : '',
    reasoningActive ? styles.composerInnerReasoning : '',
    dragActive ? styles.composerInnerDragActive : '',
    showSlashMenu || showPersonalityMenu || showNamePromptMenu || showHashMenu || showAtMenu
      ? styles.composerInnerMenuNest
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  const autoGrow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  useEffect(() => {
    autoGrow()
  }, [text])

  useEffect(() => {
    if (composerRef) {
      composerRef.current = {
        setText: (value: string) => {
          setText(value)
          requestAnimationFrame(() => textareaRef.current?.focus())
        },
        focus: () => textareaRef.current?.focus(),
      }
    }
  }, [composerRef])

  const submit = (deliverAs?: QueuedAgentMessageMode) => {
    if (!hasInput || disabled) return

    if (editingQueueId) {
      onReplaceQueue(
        queuedMessages.map((message) =>
          message.id === editingQueueId
            ? { ...message, text: composerPayload, attachments: [...attachments] }
            : message,
        ),
      )
      setEditingQueueId(null)
      setText('')
      setFileMentions([])
      setSkillMentions([])
      setAttachments([])
      setAttachError(null)
      return
    }

    onSubmit(composerPayload, running ? deliverAs ?? 'followUp' : undefined, attachments)
    setText('')
    setFileMentions([])
    setSkillMentions([])
    setAttachments([])
    setAttachError(null)
  }

  const handleEditQueuedMessage = (messageId: string) => {
    const message = queuedMessages.find((item) => item.id === messageId)
    if (!message) return
    setEditingQueueId(messageId)
    setText(message.text)
    setFileMentions([])
    setSkillMentions([])
    setAttachments([...(message.attachments ?? [])])
    setAttachError(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleRemoveQueuedMessage = (messageId: string) => {
    onReplaceQueue(queuedMessages.filter((message) => message.id !== messageId))
    if (editingQueueId === messageId) {
      setEditingQueueId(null)
      setText('')
      setFileMentions([])
      setSkillMentions([])
      setAttachments([])
      setAttachError(null)
    }
  }

  const handleMoveQueuedMessageUp = (messageId: string) => {
    const index = queuedMessages.findIndex((message) => message.id === messageId)
    if (index <= 0) return
    const next = [...queuedMessages]
    const [item] = next.splice(index, 1)
    next.splice(index - 1, 0, item)
    onReplaceQueue(next)
  }

  const applyAttachmentResult = (
    nextAttachments: readonly ConductorComposerAttachment[],
    error?: string,
  ) => {
    if (nextAttachments.length > 0) {
      setAttachments((current) => mergeConductorAttachments(current, nextAttachments))
      setAttachError(error ?? null)
      return
    }
    if (error) {
      setAttachError(error)
    }
  }

  const mergeFiles = (files: readonly File[]) => {
    if (disabled || files.length === 0) return
    void readConductorImageAttachmentsFromFiles(files).then(({ attachments: nextAttachments, error }) => {
      applyAttachmentResult(nextAttachments, error)
    })
  }

  const handlePickImages = async () => {
    if (disabled || pickingImages) return
    setPickingImages(true)
    setAttachError(null)
    try {
      const result = await window.api.agentChat.pickImages()
      applyAttachmentResult(result.attachments, result.error)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setAttachError(message || 'Could not open image picker.')
      fileInputRef.current?.click()
    } finally {
      setPickingImages(false)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    mergeFiles(files)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    const files = extractImageFilesFromDataTransfer(event.dataTransfer)
    mergeFiles(files)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false)
    }
  }

  const dragHandlers = {
    onPasteCapture: handlePaste,
    onDropCapture: handleDrop,
    onDragOverCapture: handleDragOver,
    onDragEnterCapture: handleDragEnter,
    onDragLeaveCapture: handleDragLeave,
  }

  return (
    <div className={styles.composer}>
      <div className={styles.composerStack}>
        {showAtMenu || showHashMenu || showPersonalityMenu || showSlashMenu || showNamePromptMenu ? (
          <div className={styles.composerMenus}>
            {showAtMenu ? (
              <ConductorAtMenu
                items={atItems}
                selectedItem={selectedAtItem}
                loading={atLoading}
                indexing={atIndexing}
                error={atFetchError}
                appearanceThemeId={appearanceThemeId}
                onSelect={onSelectAtMention}
              />
            ) : showHashMenu ? (
              <ConductorHashMenu
                prs={filteredPrs}
                selectedPr={selectedPr}
                loading={hashLoading}
                error={hashFetchError}
                onSelect={onSelectHashMention}
              />
            ) : showPersonalityMenu ? (
              <ConductorPersonalityMenu
                selectedIndex={optionIndex}
                onSelect={onSelectPersonalityOption}
              />
            ) : showNamePromptMenu && namePromptVariant ? (
              <ConductorSlashNamePrompt
                variant={namePromptVariant}
                onConfirm={onConfirmNamePrompt}
                onBrowse={async () =>
                  namePromptVariant === 'dir-name'
                    ? window.api.app.selectDirectory()
                    : window.api.app.selectFile()
                }
              />
            ) : (
              <ConductorSlashMenu
                sections={slashSections}
                selectedCommand={selectedSlashCommand}
                onSelect={onSelectSlashCommand}
              />
            )}
          </div>
        ) : null}
        <div
          className={composerInnerClass}
          ref={composerInnerRef}
          data-plan={plan ? 'true' : undefined}
          data-reasoning={reasoningActive ? effortLevel : undefined}
          {...dragHandlers}
        >
        <input
          ref={fileInputRef}
          type="file"
          accept={CONDUCTOR_IMAGE_ACCEPT}
          multiple
          className={styles.composerFileInput}
          tabIndex={-1}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            mergeFiles(files)
          }}
        />
        {queuedMessages.length > 0 ? (
          <ConductorMessageQueue
            messages={queuedMessages}
            editingMessageId={editingQueueId}
            onEdit={handleEditQueuedMessage}
            onRemove={handleRemoveQueuedMessage}
            onMoveUp={handleMoveQueuedMessageUp}
          />
        ) : null}
        {attachError ? (
          <div className={styles.composerAttachError} role="alert">
            {attachError}
          </div>
        ) : null}
          <div className={styles.composerInputBlock}>
          {showFocusHint ? <span className={styles.composerHint}>⌘L to focus</span> : null}
          {showRunningHint ? (
            <span className={styles.composerRunningHint}>{runningHint}</span>
          ) : null}
          {fileMentions.length > 0 || skillMentions.length > 0 ? (
            <div className={styles.composerFileChips}>
              {skillMentions.map((mention) => (
                <ComposerSkillChip key={mention.id} mention={mention} onRemove={removeSkillMention} />
              ))}
              {fileMentions.map((mention) => (
                <ComposerFileChip key={mention.id} mention={mention} onRemove={removeFileMention} />
              ))}
            </div>
          ) : null}
          <textarea
              ref={textareaRef}
              className={[
                styles.composerTextarea,
                fileMentions.length > 0 || skillMentions.length > 0
                  ? styles.composerTextareaWithChips
                  : '',
                queuedMessages.length > 0 ? styles.composerTextareaQueued : '',
                showFocusHint || showRunningHint ? styles.composerTextareaWithHint : '',
              ]
                .filter(Boolean)
                .join(' ')}
              placeholder={textareaPlaceholder}
              rows={1}
              value={text}
              disabled={disabled}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => {
                setText(e.target.value)
                const pos = e.target.selectionStart ?? e.target.value.length
                onComposerSelectionChange(pos)
                onHashSelectionChange(pos)
                onAtSelectionChange(pos)
              }}
              onClick={(e) => {
                const pos = e.currentTarget.selectionStart ?? text.length
                onComposerSelectionChange(pos)
                onHashSelectionChange(pos)
                onAtSelectionChange(pos)
              }}
              onKeyUp={(e) => {
                const pos = e.currentTarget.selectionStart ?? text.length
                onComposerSelectionChange(pos)
                onHashSelectionChange(pos)
                onAtSelectionChange(pos)
              }}
              onSelect={(e) => {
                const pos = e.currentTarget.selectionStart ?? text.length
                onComposerSelectionChange(pos)
                onHashSelectionChange(pos)
                onAtSelectionChange(pos)
              }}
              {...dragHandlers}
              onKeyDown={wrapAtKeyDown(wrapHashKeyDown(wrapComposerKeyDown((e) => {
            if (
              e.key === 'Backspace' &&
              !showAtMenu &&
              !showHashMenu &&
              !showSlashMenu &&
              !showPersonalityMenu &&
              !showNamePromptMenu
            ) {
              const el = textareaRef.current
              const start = el?.selectionStart ?? 0
              const end = el?.selectionEnd ?? 0
              if (shouldBackspaceRemoveLastFileMention(start, end, fileMentions.length)) {
                e.preventDefault()
                popLastFileMention()
                return
              }
              if (shouldBackspaceRemoveLastFileMention(start, end, skillMentions.length)) {
                e.preventDefault()
                popLastSkillMention()
                return
              }
            }
            if (e.key === 'Escape') {
              if (showAtMenu) {
                e.preventDefault()
                dismissAtUi()
              } else if (showHashMenu) {
                e.preventDefault()
                dismissHashUi()
              } else if (showSlashMenu || showPersonalityMenu || showNamePromptMenu) {
                e.preventDefault()
                dismissSlashUi()
              } else if (dragActive) {
                e.preventDefault()
                setDragActive(false)
              } else if (attachError) {
                e.preventDefault()
                setAttachError(null)
              } else if (editingQueueId) {
                e.preventDefault()
                setEditingQueueId(null)
                setText('')
                setFileMentions([])
                setSkillMentions([])
                setAttachments([])
              } else if (running) {
                e.preventDefault()
                onCancel()
              }
            } else if (
              e.key === 'Tab' &&
              e.shiftKey &&
              !showAtMenu &&
              !showHashMenu &&
              !showSlashMenu &&
              !showPersonalityMenu &&
              !showNamePromptMenu
            ) {
              e.preventDefault()
              onSetPlan(!plan)
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (e.metaKey || e.ctrlKey) {
                submit('steer')
              } else {
                submit()
              }
            } else if (e.key === 'ArrowUp' && text.length === 0) {
              e.preventDefault()
              onHistoryUp()
            }
          })))}
          />
          {dragActive ? (
            <div className={styles.composerDropIndicator} aria-hidden>
              Drop images to attach
            </div>
          ) : null}
        </div>
        {attachments.length > 0 ? (
          <div className={styles.composerAttachments} aria-label="Attached images">
            {attachments.map((attachment) => (
              <div className={styles.composerAttachment} key={attachment.id}>
                <img
                  alt={attachment.name}
                  className={styles.composerAttachmentPreview}
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                />
                <span className={styles.composerAttachmentName}>{attachment.name}</span>
                <button
                  type="button"
                  className={styles.composerAttachmentRemove}
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className={styles.composerFooter}>
          <div className={styles.composerActionsLeft}>
            <ChatModelSelector
              provider={provider}
              model={model}
              thinkingLevel={thinkingLevel}
              workspacePath={workspacePath}
              onSelect={onSetModel}
            />
            {showFast ? <FastToggle active={fastActive} onChange={onToggleFast} /> : null}
            {showEffort ? (
              <EffortPill provider={provider} level={effortLevel} onChange={onSetThinkingLevel} />
            ) : null}
            <button
              type="button"
              className={[
                styles.composerChip,
                plan ? styles.composerChipWarm : styles.composerChipNeutral,
                styles.planToggle,
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={plan}
              data-plan-active={plan ? 'true' : undefined}
              title={plan ? 'Plan mode on (Shift+Tab)' : 'Plan mode off (Shift+Tab)'}
              onClick={() => onSetPlan(!plan)}
            >
              <PlanMapIcon />
              Plan
            </button>
          </div>
          <div className={styles.composerActionsRight}>
            <ContextUsageHover
              provider={provider}
              sessionId={sessionId}
              model={model}
              transcript={transcript}
              queuedMessages={contextQueuedMessages}
              draftText={contextDraftText}
              draftAttachments={contextDraftAttachments}
            />
            <button
              type="button"
              className={styles.composerAttachBtn}
              aria-label="Attach image"
              title="Attach an image, then describe what you want"
              disabled={disabled || pickingImages}
              onClick={() => void handlePickImages()}
            >
              <Plus size={18} strokeWidth={1.8} />
            </button>
            {running ? (
              <button
                type="button"
                className={styles.stopButton}
                onClick={onCancel}
                aria-label="Stop"
                title="Stop (Esc)"
              >
                <ComposerStopIcon />
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendButton}
                onClick={() => submit()}
                disabled={!hasInput || disabled}
                aria-label="Send"
              >
                <ComposerSendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
