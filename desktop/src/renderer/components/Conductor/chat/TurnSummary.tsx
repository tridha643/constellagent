import { type ReactNode } from 'react'
import { Collapsible } from '@base-ui-components/react/collapsible'
import { ChevronDownIcon, PlanMapIcon } from './ConductorIcons'
import styles from '../Conductor.module.css'

/**
 * Collapsible turn header (shot 4): `⚙ N tool calls, M messages` disclosing a
 * completed turn's tool rows (never its messages — those stay visible). Built on
 * Base UI's headless Collapsible, styled with CSS modules so there is no
 * CSS-in-JS / architecture conflict. Plan-mode turns get the map icon.
 */
export function TurnSummary({
  toolCount,
  messageCount,
  failedToolCount = 0,
  toolSummary,
  isPlan,
  open,
  onOpenChange,
  children,
}: {
  toolCount: number
  messageCount: number
  failedToolCount?: number
  toolSummary?: string
  isPlan?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  children?: ReactNode
}) {
  const label = `${toolCount} tool call${toolCount === 1 ? '' : 's'}, ${messageCount} message${
    messageCount === 1 ? '' : 's'
  }`
  const statusLabel = failedToolCount > 0 ? `${failedToolCount} failed` : null
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} className={styles.turnSummary}>
      <Collapsible.Trigger
        className={styles.turnSummaryHeader}
        data-testid="turn-summary-header"
        aria-label={`${label}${toolSummary ? `, ${toolSummary}` : ''}${statusLabel ? `, ${statusLabel}` : ''}`}
      >
        <span className={styles.collapsibleChevron}>
          <ChevronDownIcon size={12} />
        </span>
        {isPlan ? <PlanMapIcon size={13} /> : null}
        <span className={styles.turnSummaryLabel}>{label}</span>
        {toolSummary ? <span className={styles.turnSummaryMeta}>{toolSummary}</span> : null}
        {statusLabel ? <span className={styles.turnSummaryError}>{statusLabel}</span> : null}
      </Collapsible.Trigger>
      <Collapsible.Panel className={`${styles.collapsiblePanel} ${styles.turnSummaryPanel}`}>
        <div className={styles.turnSummaryBody}>{open ? children : null}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
