import { Collapsible } from '@base-ui-components/react/collapsible'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { ChevronDownIcon } from '../ConductorIcons'
import { bashSummaryMarkdown, fencedCodeBlock, MarkdownBody } from '../MarkdownBody'
import { stripAnsi } from './diff-utils'
import styles from '../../Conductor.module.css'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function shellCommand(input: unknown): string {
  if (typeof input === 'string') return input
  const record = asRecord(input)
  const command = record?.command
  if (typeof command === 'string') return command
  return ''
}

function shellDescription(input: unknown): string | undefined {
  const record = asRecord(input)
  const description = record?.description
  return typeof description === 'string' && description.trim() ? description.trim() : undefined
}

function shellOutput(output: unknown): string {
  if (typeof output === 'string') return stripAnsi(output).trim()
  return ''
}

function BashHeader({ description, command, expandable }: { description?: string; command: string; expandable?: boolean }) {
  return (
    <>
      {expandable ? (
        <span className={styles.collapsibleChevron}>
          <ChevronDownIcon size={12} />
        </span>
      ) : null}
      <span className={styles.bashGlyph} aria-hidden>
        ⌘
      </span>
      <MarkdownBody
        content={bashSummaryMarkdown(description, command)}
        className={styles.bashHeaderMarkdown}
        compact
        inline
      />
    </>
  )
}

/** Renders `shell`/`bash` tool calls through ProseMark (summary + fenced output). */
export function BashTool({ tool }: { tool: TimelineToolCall }) {
  const command = shellCommand(tool.input)
  const description = shellDescription(tool.input)
  const output = shellOutput(tool.output)

  if (!output) {
    return (
      <div className={styles.bashCard}>
        <div className={styles.bashHeader}>
          <BashHeader description={description} command={command} />
        </div>
      </div>
    )
  }

  return (
    <Collapsible.Root className={styles.bashCard}>
      <Collapsible.Trigger className={styles.bashHeader}>
        <BashHeader description={description} command={command} expandable />
      </Collapsible.Trigger>
      <Collapsible.Panel className={styles.collapsiblePanel}>
        <MarkdownBody content={fencedCodeBlock('text', output)} className={styles.bashOutput} compact />
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
