import { useEffect, useRef, useState } from 'react'
import type { AgentProvider, QueuedAgentMessage, QueuedAgentMessageMode } from '../../../../shared/agent-chat-types'
import { hasEffortVariants, hasFastVariant, isFastModel } from '../../../../shared/conductor-model-utils'
import { normalizeThinkingLevel, isReasoningEffortActive, type ThinkingLevel } from '../../../../shared/conductor-thinking'
import { ChatModelSelector } from './ChatModelSelector'
import { EffortPill } from './EffortPill'
import { FastToggle } from './FastToggle'
import { PlanMapIcon } from './ConductorIcons'
import { ConductorMessageQueue } from './ConductorMessageQueue'
import {
  ContextPanel,
  ContextRingButton,
  useConductorContextUsage,
  useContextPanelDismiss,
} from './ContextWindowControl'
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
}: {
  provider: AgentProvider
  model: string
  thinkingLevel: ThinkingLevel
  plan: boolean
  running: boolean
  disabled?: boolean
  queuedMessages: readonly QueuedAgentMessage[]
  onSubmit: (text: string, deliverAs?: QueuedAgentMessageMode) => void
  onCancel: () => void
  onReplaceQueue: (messages: readonly QueuedAgentMessage[]) => void
  onSetModel: (provider: AgentProvider, model: string) => void
  onSetThinkingLevel: (level: ThinkingLevel) => void
  onToggleFast: (fast: boolean) => void
  onSetPlan: (plan: boolean) => void
  onHistoryUp: () => void
  composerRef?: React.RefObject<ChatComposerHandle | null>
}) {
  const [text, setText] = useState('')
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerInnerRef = useRef<HTMLDivElement | null>(null)
  const { data: contextData, idle: contextIdle } = useConductorContextUsage()
  const modelLabel = `${provider} · ${model}`
  const showEffort = hasEffortVariants(model, provider)
  const showFast = hasFastVariant(model, provider)
  const fastActive = isFastModel(model)
  const effortLevel = normalizeThinkingLevel(thinkingLevel)
  const reasoningActive = isReasoningEffortActive(effortLevel)
  const runningHint = 'Enter · queue · ⌘↵ · steer · Esc · stop'
  const showFocusHint = !focused && !contextOpen && !disabled && !running
  const showRunningHint = running && !focused && !contextOpen && !disabled

  const composerInnerClass = [
    styles.composerInner,
    plan ? styles.composerInnerPlan : '',
    reasoningActive ? styles.composerInnerReasoning : '',
  ]
    .filter(Boolean)
    .join(' ')

  useContextPanelDismiss(contextOpen, () => setContextOpen(false), composerInnerRef)

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
    if (!trimmed || disabled) return

    if (editingQueueId) {
      onReplaceQueue(
        queuedMessages.map((message) =>
          message.id === editingQueueId ? { ...message, text: trimmed } : message,
        ),
      )
      setEditingQueueId(null)
      setText('')
      return
    }

    onSubmit(trimmed, running ? deliverAs ?? 'followUp' : undefined)
    setText('')
  }

  const handleEditQueuedMessage = (messageId: string) => {
    const message = queuedMessages.find((item) => item.id === messageId)
    if (!message) return
    setEditingQueueId(messageId)
    setText(message.text)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleRemoveQueuedMessage = (messageId: string) => {
    onReplaceQueue(queuedMessages.filter((message) => message.id !== messageId))
    if (editingQueueId === messageId) {
      setEditingQueueId(null)
      setText('')
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

  return (
    <div className={styles.composer}>
      <div
        className={composerInnerClass}
        ref={composerInnerRef}
        data-plan={plan ? 'true' : undefined}
        data-reasoning={reasoningActive ? effortLevel : undefined}
      >
        {contextOpen && (
          <ContextPanel data={contextData} idle={contextIdle} modelLabel={modelLabel} />
        )}
        {queuedMessages.length > 0 ? (
          <ConductorMessageQueue
            messages={queuedMessages}
            editingMessageId={editingQueueId}
            onEdit={handleEditQueuedMessage}
            onRemove={handleRemoveQueuedMessage}
            onMoveUp={handleMoveQueuedMessageUp}
          />
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
            placeholder="Ask to make changes, @mention files, reference PRs with #, run /commands"
            rows={1}
            value={text}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (contextOpen) {
                e.preventDefault()
                setContextOpen(false)
              } else if (editingQueueId) {
                e.preventDefault()
                setEditingQueueId(null)
                setText('')
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
        </div>
        <div className={styles.composerFooter}>
          <div className={styles.composerActionsLeft}>
            <ChatModelSelector provider={provider} model={model} thinkingLevel={thinkingLevel} onSelect={onSetModel} />
            {showFast ? <FastToggle active={fastActive} onChange={onToggleFast} /> : null}
            {showEffort ? (
              <EffortPill provider={provider} level={effortLevel} onChange={onSetThinkingLevel} />
            ) : null}
            <button
              type="button"
              className={`${styles.composerChip} ${plan ? styles.composerChipWarm : styles.composerChipNeutral} ${styles.planToggle}`}
              aria-pressed={plan}
              title="Plan mode (Shift+Tab)"
              onClick={() => onSetPlan(!plan)}
            >
              <PlanMapIcon />
              Plan
            </button>
          </div>
          <div className={styles.composerActionsRight}>
            <ContextRingButton
              percentage={contextData.percentage}
              open={contextOpen}
              onToggle={() => setContextOpen((v) => !v)}
            />
            {running ? (
              <button
                type="button"
                className={styles.stopButton}
                onClick={onCancel}
                aria-label="Stop"
                title="Stop (Esc)"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendButton}
                onClick={() => submit()}
                disabled={!text.trim() || disabled}
                aria-label="Send"
              >
                <SendArrowIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SendArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  )
}
