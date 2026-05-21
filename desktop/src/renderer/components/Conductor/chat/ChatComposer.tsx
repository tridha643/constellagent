import { useEffect, useRef, useState } from 'react'
import type { AgentProvider } from '../../../../shared/agent-chat-types'
import { hasEffortVariants, hasFastVariant, isFastModel } from '../../../../shared/conductor-model-utils'
import { normalizeThinkingLevel, type ThinkingLevel } from '../../../../shared/conductor-thinking'
import { ChatModelSelector } from './ChatModelSelector'
import { EffortPill } from './EffortPill'
import { FastToggle } from './FastToggle'
import { PlanMapIcon } from './ConductorIcons'
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
  onSubmit,
  onCancel,
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
  onSubmit: (text: string) => void
  onCancel: () => void
  onSetModel: (provider: AgentProvider, model: string) => void
  onSetThinkingLevel: (level: ThinkingLevel) => void
  onToggleFast: (fast: boolean) => void
  onSetPlan: (plan: boolean) => void
  onHistoryUp: () => void
  composerRef?: React.RefObject<ChatComposerHandle | null>
}) {
  const [text, setText] = useState('')
  const [contextOpen, setContextOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerInnerRef = useRef<HTMLDivElement | null>(null)
  const { data: contextData, idle: contextIdle } = useConductorContextUsage()
  const modelLabel = `${provider} · ${model}`
  const showEffort = hasEffortVariants(model)
  const showFast = hasFastVariant(model)
  const fastActive = isFastModel(model)
  const effortLevel = normalizeThinkingLevel(thinkingLevel)
  const reasoningActive = effortLevel !== 'low'
  const showFocusHint = !focused && !contextOpen && !disabled

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

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || running) return
    onSubmit(trimmed)
    setText('')
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
        {showFocusHint ? <span className={styles.composerHint}>⌘L to focus</span> : null}
        <textarea
          ref={textareaRef}
          className={`${styles.composerTextarea} ${showFocusHint ? styles.composerTextareaWithHint : ''}`}
          placeholder="Ask to make changes, @mention files, reference PRs with #, run /commands"
          rows={1}
          value={text}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault()
              onSetPlan(!plan)
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            } else if (e.key === 'ArrowUp' && text.length === 0) {
              e.preventDefault()
              onHistoryUp()
            }
          }}
        />
        <div className={styles.composerFooter}>
          <div className={styles.composerActionsLeft}>
            <ChatModelSelector provider={provider} model={model} thinkingLevel={thinkingLevel} onSelect={onSetModel} />
            {showFast ? <FastToggle active={fastActive} onChange={onToggleFast} /> : null}
            {showEffort ? (
              <EffortPill level={effortLevel} onChange={onSetThinkingLevel} />
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
              <button type="button" className={styles.stopButton} onClick={onCancel} aria-label="Stop">
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendButton}
                onClick={submit}
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
