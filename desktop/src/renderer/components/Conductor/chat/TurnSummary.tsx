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
  isPlan,
  defaultExpanded,
  children,
}: {
  toolCount: number
  messageCount: number
  isPlan?: boolean
  defaultExpanded?: boolean
  children: ReactNode
}) {
  return (
    <Collapsible.Root defaultOpen={Boolean(defaultExpanded)} className={styles.turnSummary}>
      <Collapsible.Trigger className={styles.turnSummaryHeader}>
        <span className={styles.collapsibleChevron}>
          <ChevronDownIcon size={12} />
        </span>
        {isPlan ? <PlanMapIcon size={13} /> : null}
        <span className={styles.turnSummaryLabel}>
          {toolCount} tool call{toolCount === 1 ? '' : 's'}, {messageCount} message
          {messageCount === 1 ? '' : 's'}
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className={styles.collapsiblePanel}>
        <div className={styles.turnSummaryBody}>{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
