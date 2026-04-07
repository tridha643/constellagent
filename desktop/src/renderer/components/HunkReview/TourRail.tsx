import type { DiffAnnotation } from '@shared/diff-annotation-types'
import { annotationLineEnd } from '@shared/diff-annotation-types'
import styles from './TourRail.module.css'

interface TourStep {
  id: string
  annotation: DiffAnnotation
}

interface TourRailProps {
  steps: TourStep[]
  activeStepId: string | null
  onSelectStep: (stepId: string) => void
  onPrevious: () => void
  onNext: () => void
}

function truncate(text: string | undefined, maxLength: number) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}...`
}

function stepLineLabel(annotation: DiffAnnotation) {
  const end = annotationLineEnd(annotation)
  return end === annotation.lineNumber ? `L${annotation.lineNumber}` : `L${annotation.lineNumber}-${end}`
}

export function TourRail({ steps, activeStepId, onSelectStep, onPrevious, onNext }: TourRailProps) {
  const activeIndex = steps.findIndex((step) => step.id === activeStepId)
  const activeStep = activeIndex >= 0 ? steps[activeIndex] : null

  if (steps.length === 0) {
    return (
      <section className={styles.container} aria-label="Code tour">
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>Code Tour</div>
          <p className={styles.emptyCopy}>
            No agent-authored tour steps yet. Add annotations with summaries and rationale to build a walkthrough.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.container} aria-label="Code tour">
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Code Tour</div>
          <div className={styles.title}>Walk the important changes</div>
        </div>
        <div className={styles.progressBadge}>
          Step {Math.max(activeIndex + 1, 1)} of {steps.length}
        </div>
      </div>

      <p className={styles.overview}>
        Agent-authored annotations become a guided walkthrough so you can understand the change before scanning every hunk.
      </p>

      {activeStep && (
        <div className={styles.activeCard}>
          <div className={styles.activeMetaRow}>
            <span className={styles.activeStepNumber}>Step {activeIndex + 1}</span>
            <span className={styles.activeLocation}>
              {activeStep.annotation.filePath} · {stepLineLabel(activeStep.annotation)}
            </span>
          </div>
          <div className={styles.activeTitle}>{activeStep.annotation.body}</div>
          {activeStep.annotation.rationale && (
            <p className={styles.activeRationale}>{activeStep.annotation.rationale}</p>
          )}
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.controlBtn}
              onClick={onPrevious}
              disabled={activeIndex <= 0}
            >
              Previous
            </button>
            <button
              type="button"
              className={styles.controlBtn}
              onClick={onNext}
              disabled={activeIndex >= steps.length - 1}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {steps.map((step, index) => {
          const active = step.id === activeStepId
          return (
            <button
              key={step.id}
              type="button"
              className={`${styles.stepCard} ${active ? styles.stepCardActive : ''}`}
              onClick={() => onSelectStep(step.id)}
            >
              <div className={styles.stepHeader}>
                <span className={styles.stepIndex}>{index + 1}</span>
                <span className={styles.stepPath}>{step.annotation.filePath}</span>
                <span className={styles.stepLines}>{stepLineLabel(step.annotation)}</span>
              </div>
              <div className={styles.stepTitle}>{step.annotation.body}</div>
              {!!step.annotation.rationale && (
                <p className={styles.stepPreview}>{truncate(step.annotation.rationale, active ? 200 : 110)}</p>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
