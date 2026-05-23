import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Plus, X } from 'lucide-react'
import type { AgentProvider, QueuedAgentMessage, QueuedAgentMessageMode } from '../../../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../../../shared/conductor-attachments'
import { hasEffortVariants, hasFastVariant, isFastModel } from '../../../../shared/conductor-model-utils'
import { normalizeThinkingLevel, isReasoningEffortActive, type ThinkingLevel } from '../../../../shared/conductor-thinking'
import { ChatModelSelector } from './ChatModelSelector'
import { EffortPill } from './EffortPill'
import { FastToggle } from './FastToggle'
import { ComposerSendIcon, ComposerStopIcon, PlanMapIcon } from './ConductorIcons'
import { ConductorMessageQueue } from './ConductorMessageQueue'
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
}: {
  provider: AgentProvider
  model: string
  thinkingLevel: ThinkingLevel
  plan: boolean
  running: boolean
  disabled?: boolean
  queuedMessages: readonly QueuedAgentMessage[]
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
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<ConductorComposerAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [pickingImages, setPickingImages] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerInnerRef = useRef<HTMLDivElement | null>(null)
  const modelLabel = `${provider} · ${model}`
  const showEffort = hasEffortVariants(model, provider)
  const showFast = hasFastVariant(model, provider)
  const fastActive = isFastModel(model)
  const effortLevel = normalizeThinkingLevel(thinkingLevel)
  const reasoningActive = isReasoningEffortActive(effortLevel)
  const runningHint = 'Enter · queue · ⌘↵ · steer · Esc · stop'
  const showFocusHint = !focused && !disabled && !running
  const showRunningHint = running && !focused && !disabled
  const hasInput = text.trim().length > 0 || attachments.length > 0
  const textareaPlaceholder =
    attachments.length > 0
      ? 'Describe what you want about the attached image…'
      : 'Ask to make changes, @mention files, reference PRs with #, run /commands'

  const composerInnerClass = [
    styles.composerInner,
    plan ? styles.composerInnerPlan : '',
    reasoningActive ? styles.composerInnerReasoning : '',
    dragActive ? styles.composerInnerDragActive : '',
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
    const trimmed = text.trim()
    if (!hasInput || disabled) return

    if (editingQueueId) {
      onReplaceQueue(
        queuedMessages.map((message) =>
          message.id === editingQueueId
            ? { ...message, text: trimmed, attachments: [...attachments] }
            : message,
        ),
      )
      setEditingQueueId(null)
      setText('')
      setAttachments([])
      setAttachError(null)
      return
    }

    onSubmit(trimmed, running ? deliverAs ?? 'followUp' : undefined, attachments)
    setText('')
    setAttachments([])
    setAttachError(null)
  }

  const handleEditQueuedMessage = (messageId: string) => {
    const message = queuedMessages.find((item) => item.id === messageId)
    if (!message) return
    setEditingQueueId(messageId)
    setText(message.text)
    setAttachments([...(message.attachments ?? [])])
    setAttachError(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleRemoveQueuedMessage = (messageId: string) => {
    onReplaceQueue(queuedMessages.filter((message) => message.id !== messageId))
    if (editingQueueId === messageId) {
      setEditingQueueId(null)
      setText('')
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
          <textarea
            ref={textareaRef}
            className={[
              styles.composerTextarea,
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
            onChange={(e) => setText(e.target.value)}
            {...dragHandlers}
            onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (dragActive) {
                e.preventDefault()
                setDragActive(false)
              } else if (attachError) {
                e.preventDefault()
                setAttachError(null)
              } else if (editingQueueId) {
                e.preventDefault()
                setEditingQueueId(null)
                setText('')
                setAttachments([])
              } else if (running) {
                e.preventDefault()
                onCancel()
              }
            } else if (e.key === 'Tab' && e.shiftKey) {
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
          }}
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
            <ChatModelSelector provider={provider} model={model} thinkingLevel={thinkingLevel} onSelect={onSetModel} />
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
                plan ? '' : styles.planToggleIconOnly,
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={plan}
              data-plan-active={plan ? 'true' : undefined}
              title={plan ? 'Plan mode on (Shift+Tab)' : 'Plan mode (Shift+Tab)'}
              aria-label={plan ? 'Plan mode on. Click to disable.' : 'Enable plan mode'}
              onClick={() => onSetPlan(!plan)}
            >
              <PlanMapIcon />
              {plan ? 'Plan' : null}
            </button>
          </div>
          <div className={styles.composerActionsRight}>
            <ContextUsageHover provider={provider} sessionId={sessionId} />
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
  )
}

