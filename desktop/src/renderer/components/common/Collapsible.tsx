import type { ReactNode } from 'react'
import styles from './Collapsible.module.css'

export interface CollapsibleProps {
  /** When true the content is at full height; when false it collapses to 0. */
  open: boolean
  children: ReactNode
  className?: string
  /** Optional id for aria-controls wiring from a trigger. */
  id?: string
}

/**
 * Height-agnostic collapse via the `grid-template-rows: 1fr → 0fr` trick
 * (rudu accordion / group-card port). The animated property is the grid row
 * track, so no JS height measurement is needed and it stays interruptible.
 *
 * The inner wrapper must keep `overflow: hidden; min-height: 0` (in the module)
 * for the row to actually clip during the transition. Reduced motion drops the
 * tween — content snaps open/closed — via the module's media query.
 */
export function Collapsible({ open, children, className, id }: CollapsibleProps) {
  return (
    <div
      id={id}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-state={open ? 'open' : 'closed'}
      aria-hidden={open ? undefined : true}
    >
      <div className={styles.inner}>{children}</div>
    </div>
  )
}
