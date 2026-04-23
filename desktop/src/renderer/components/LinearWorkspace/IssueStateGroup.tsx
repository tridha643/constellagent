import { CaretDown } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { LinearIssueStateType } from '../../store/types'
import styles from './IssueStateGroup.module.css'

interface IssueStateGroupProps {
  stateType: LinearIssueStateType
  label: string
  count: number
  collapsed: boolean
  onToggle: (stateType: LinearIssueStateType) => void
  children: ReactNode
}

/**
 * Collapsible section for one state bucket in the Issues list.
 * Header is sticky + blurred so it reads as a column label while the body scrolls.
 */
export function IssueStateGroup({
  stateType,
  label,
  count,
  collapsed,
  onToggle,
  children,
}: IssueStateGroupProps) {
  return (
    <section
      className={styles.group}
      data-state-type={stateType}
      data-collapsed={collapsed ? 'true' : 'false'}
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
