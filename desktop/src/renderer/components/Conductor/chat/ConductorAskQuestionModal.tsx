import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConductorAskQuestionAnswer,
  ConductorAskQuestionDetails,
  ConductorBlockingQuestion,
} from '../../../../shared/conductor-ask-question-types'
import {
  buildOptionMappings,
  clampAskQuestionHeader,
  optionLetter,
} from '../../../../shared/conductor-ask-question-types'
import { useFocusTrap } from '../../../hooks/useFocusTrap'
import { useExitAnimation } from '../../../hooks/useExitAnimation'
import styles from '../Conductor.module.css'

interface QuestionUiState {
  selected: Set<number>
  customOnlyAnswer: string | null
  extraDetails: string | null
}

/** Match `constellagent-dialog-*--exiting` duration (`--duration-exit` in design-tokens). */
const EXIT_MS = 140

/**
 * Host that keeps the last question mounted through the shared dialog exit
 * transition after `blockingQuestion` clears (answer submitted or cancelled).
 */
export function ConductorAskQuestionModal({
  question,
  onSubmit,
  onCancel,
}: {
  question: ConductorBlockingQuestion | null
  onSubmit: (details: ConductorAskQuestionDetails) => void
  onCancel: () => void
}) {
  const [lastQuestion, setLastQuestion] = useState(question)
  if (question && question !== lastQuestion) {
    setLastQuestion(question)
  }
  const { shouldRender, animating } = useExitAnimation(Boolean(question), EXIT_MS)
  if (!shouldRender || !lastQuestion) return null
  return (
    <AskQuestionCard
      question={lastQuestion}
      exiting={animating === 'exit'}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}

function AskQuestionCard({
  question,
  exiting,
  onSubmit,
  onCancel,
}: {
  question: ConductorBlockingQuestion
  exiting: boolean
  onSubmit: (details: ConductorAskQuestionDetails) => void
  onCancel: () => void
}) {
  const questions = question.questions
  const [page, setPage] = useState(0)
  const [highlight, setHighlight] = useState(0)
  const [customDraft, setCustomDraft] = useState('')
  const [editingCustom, setEditingCustom] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Trap Tab focus inside this blocking question modal so keyboard nav can't
  // escape to the obscured chat behind it while an answer is required.
  useFocusTrap(cardRef)

  const [states, setStates] = useState<Map<string, QuestionUiState>>(() => {
    const initial = new Map<string, QuestionUiState>()
    for (const item of questions) {
      initial.set(item.header, { selected: new Set(), customOnlyAnswer: null, extraDetails: null })
    }
    return initial
  })

  const current = questions[page]
  const currentState = current ? states.get(current.header) : undefined
  const rowCount = current ? current.options.length + 1 : 0

  const allAnswered = useMemo(() => {
    return questions.every((item) => {
      const state = states.get(item.header)
      return Boolean(state && (state.customOnlyAnswer || state.selected.size > 0))
    })
  }, [questions, states])

  const patchState = useCallback((header: string, patch: Partial<QuestionUiState>) => {
    setStates((prev) => {
      const next = new Map(prev)
      const existing = next.get(header) ?? { selected: new Set(), customOnlyAnswer: null, extraDetails: null }
      next.set(header, {
        ...existing,
        ...patch,
        selected: patch.selected ?? existing.selected,
      })
      return next
    })
  }, [])

  const buildAnswers = useCallback((): ConductorAskQuestionAnswer[] => {
    return questions.map((item) => {
      const state = states.get(item.header)!
      const optionMappings = buildOptionMappings(item.options)
      if (state.customOnlyAnswer) {
        return {
          question: item.question,
          header: item.header,
          answer: state.customOnlyAnswer,
          wasCustom: true,
          selectedOptions: [],
          optionMappings,
        }
      }
      const selectedOptions = [...state.selected]
        .sort((a, b) => a - b)
        .map((index) => item.options[index]?.label)
        .filter((value): value is string => Boolean(value))
      const base: ConductorAskQuestionAnswer = {
        question: item.question,
        header: item.header,
        answer: item.multiSelect ? selectedOptions : (selectedOptions[0] ?? ''),
        wasCustom: false,
        selectedOptions,
        optionMappings,
      }
      const details = state.extraDetails?.trim()
      return details ? { ...base, details } : base
    })
  }, [questions, states])

  const submit = useCallback(() => {
    if (!allAnswered || exiting) return
    onSubmit({ cancelled: false, answers: buildAnswers() })
  }, [allAnswered, buildAnswers, exiting, onSubmit])

  const cancel = useCallback(() => {
    if (exiting) return
    onSubmit({ cancelled: true, answers: [] })
    onCancel()
  }, [exiting, onCancel, onSubmit])

  useEffect(() => {
    setHighlight(0)
    setEditingCustom(false)
    setCustomDraft('')
  }, [page])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!current || !currentState) return
      if (event.defaultPrevented) return

      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
        return
      }

      if (editingCustom) {
        if (event.key === 'Enter') {
          event.preventDefault()
          const trimmed = customDraft.trim()
          if (!trimmed) return
          patchState(current.header, { customOnlyAnswer: trimmed, selected: new Set() })
          setEditingCustom(false)
          setCustomDraft('')
        }
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setPage((prev) => Math.max(0, prev - 1))
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setPage((prev) => Math.min(questions.length - 1, prev + 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight((prev) => Math.max(0, prev - 1))
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight((prev) => Math.min(rowCount, prev + 1))
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (highlight === 0) {
          setEditingCustom(true)
          setCustomDraft(currentState.customOnlyAnswer ?? '')
          return
        }
        const optionIndex = highlight - 1
        if (optionIndex < 0 || optionIndex >= current.options.length) return
        if (current.multiSelect) {
          const next = new Set(currentState.selected)
          if (next.has(optionIndex)) next.delete(optionIndex)
          else next.add(optionIndex)
          patchState(current.header, { selected: next, customOnlyAnswer: null })
          return
        }
        patchState(current.header, { selected: new Set([optionIndex]), customOnlyAnswer: null })
        if (page < questions.length - 1) setPage((prev) => prev + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    cancel,
    current,
    currentState,
    customDraft,
    editingCustom,
    highlight,
    page,
    patchState,
    questions.length,
    rowCount,
  ])

  if (!current || !currentState) return null

  return (
    <div
      className={`${styles.askQuestionBackdrop} constellagent-dialog-overlay ${exiting ? 'constellagent-dialog-overlay--exiting' : ''}`}
      role="presentation"
      onClick={cancel}
    >
      <div
        ref={cardRef}
        className={`${styles.askQuestionCard} constellagent-dialog-body ${exiting ? 'constellagent-dialog-body--exiting' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conductor-ask-question-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.askQuestionClose} aria-label="Close" onClick={cancel}>
          ×
        </button>

        <div key={current.header} className={styles.askQuestionPage}>
        <div className={styles.askQuestionHeaderLabel}>{clampAskQuestionHeader(current.header)}</div>
        <h2 id="conductor-ask-question-title" className={styles.askQuestionTitle}>
          {current.question}
        </h2>

        <div className={styles.askQuestionOptions}>
          <button
            type="button"
            className={`${styles.askQuestionOption} ${highlight === 0 ? styles.askQuestionOptionActive : ''}`}
            onMouseEnter={() => setHighlight(0)}
            onClick={() => {
              setEditingCustom(true)
              setCustomDraft(currentState.customOnlyAnswer ?? '')
            }}
          >
            <span className={styles.askQuestionOptionIndex}>0</span>
            <span className={styles.askQuestionOptionBody}>
              <span className={styles.askQuestionOptionLabel}>Type something…</span>
              {editingCustom ? (
                <input
                  className={styles.askQuestionCustomInput}
                  autoFocus
                  value={customDraft}
                  placeholder="Type something…"
                  onChange={(event) => setCustomDraft(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              ) : currentState.customOnlyAnswer ? (
                <span className={styles.askQuestionOptionDescription}>{currentState.customOnlyAnswer}</span>
              ) : (
                <span className={styles.askQuestionOptionDescription}>Answer in your own words</span>
              )}
            </span>
          </button>

          {current.options.map((option, index) => {
            const row = index + 1
            const selected = currentState.selected.has(index)
            return (
              <button
                key={`${current.header}-${option.label}`}
                type="button"
                className={`${styles.askQuestionOption} ${highlight === row ? styles.askQuestionOptionActive : ''} ${selected ? styles.askQuestionOptionSelected : ''}`}
                onMouseEnter={() => setHighlight(row)}
                onClick={() => {
                  if (current.multiSelect) {
                    const next = new Set(currentState.selected)
                    if (next.has(index)) next.delete(index)
                    else next.add(index)
                    patchState(current.header, { selected: next, customOnlyAnswer: null })
                    return
                  }
                  patchState(current.header, { selected: new Set([index]), customOnlyAnswer: null })
                  if (page < questions.length - 1) setPage((prev) => prev + 1)
                }}
              >
                <span className={styles.askQuestionOptionIndex}>{row}</span>
                <span className={styles.askQuestionOptionBody}>
                  <span className={styles.askQuestionOptionLabel}>
                    {optionLetter(index)} · {option.label}
                  </span>
                  {option.description ? (
                    <span className={styles.askQuestionOptionDescription}>{option.description}</span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
        </div>

        <div className={styles.askQuestionFooter}>
          <button
            type="button"
            className={styles.askQuestionNavBtn}
            aria-label="Previous question"
            disabled={page === 0}
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
          >
            ‹
          </button>
          <div className={styles.askQuestionDots} aria-hidden>
            {questions.map((item, index) => (
              <span
                key={item.header}
                className={`${styles.askQuestionDot} ${index === page ? styles.askQuestionDotActive : ''}`}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.askQuestionNavBtn}
            aria-label="Next question"
            disabled={page >= questions.length - 1}
            onClick={() => setPage((prev) => Math.min(questions.length - 1, prev + 1))}
          >
            ›
          </button>
          <button
            type="button"
            className={styles.askQuestionSubmit}
            aria-label="Submit answers"
            disabled={!allAnswered}
            onClick={submit}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
