import { CaretDown } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { LinearIssueStateType } from '../../store/types'
import styles from './IssueStateGroup.module.css'

interface IssueStateGroupProps {
  stateType: LinearIssueStateType
  label: string
  count: number
  collapsed: boolean
  onToggle: (stateType: LinearIssueStateType) => void
  /** Used by the drag-over auto-expand timer (uncollapses after a brief hover). */
  onAutoExpand?: (stateType: LinearIssueStateType) => void
  children: ReactNode
}

export const STATE_DROPPABLE_PREFIX = 'state:'

const AUTO_EXPAND_MS = 350

/**
 * Collapsible section for one state bucket in the Issues list.
 * Header is sticky + blurred so it reads as a column label while the body scrolls.
 * Also acts as a drop zone for drag-to-change-state.
 */
export function IssueStateGroup({
  stateType,
  label,
  count,
  collapsed,
  onToggle,
  onAutoExpand,
  children,
}: IssueStateGroupProps) {
  const droppableId = `${STATE_DROPPABLE_PREFIX}${stateType}`
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: 'state', stateType },
  })

  // Auto-expand a collapsed lane after hovering with a drag for ~350ms — mirrors
  // Linear's web app behavior and avoids forcing users to manually expand first.
  const autoExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (isOver && collapsed && onAutoExpand) {
      autoExpandTimer.current = setTimeout(() => {
        onAutoExpand(stateType)
      }, AUTO_EXPAND_MS)
      return () => {
        if (autoExpandTimer.current) clearTimeout(autoExpandTimer.current)
        autoExpandTimer.current = null
      }
    }
    if (!isOver && autoExpandTimer.current) {
      clearTimeout(autoExpandTimer.current)
      autoExpandTimer.current = null
    }
    return undefined
  }, [isOver, collapsed, onAutoExpand, stateType])

  return (
    <section
      ref={setNodeRef}
      className={styles.group}
      data-state-type={stateType}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-drop-active={isOver ? 'true' : 'false'}
    >
      <header className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => onToggle(stateType)}
          aria-expanded={!collapsed}
          aria-controls={`issues-group-${stateType}`}
        >
          <CaretDown
            size={12}
            weight="bold"
            aria-hidden
            className={styles.caret}
          />
          <span className={styles.label}>{label}</span>
          <span className={styles.count} aria-label={`${count} issues`}>
            {count}
          </span>
        </button>
      </header>
      {!collapsed ? (
        <div className={styles.body} id={`issues-group-${stateType}`}>
          {children}
        </div>
      ) : null}
    </section>
  )
}
