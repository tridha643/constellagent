import { useState } from 'react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { safeJsonStringify } from '../../../../../shared/json-safe'
import { MarkdownBody, toolOutputAsMarkdown } from '../MarkdownBody'
import styles from '../../Conductor.module.css'

const STATUS_GLYPH: Record<TimelineToolCall['status'], string> = {
  running: '◐',
  success: '✓',
  error: '✕',
}

const STATUS_CLASS: Record<TimelineToolCall['status'], string> = {
  running: styles.toolStatusRunning,
  success: styles.toolStatusSuccess,
  error: styles.toolStatusError,
}

function detailText(tool: TimelineToolCall): string {
  if (tool.detail) return tool.detail
  if (tool.output === undefined || tool.output === null) return ''
  return typeof tool.output === 'string' ? tool.output : safeJsonStringify(tool.output, 2)
}

/** Fallback renderer: a collapsible status row with markdown output body. */
export function GenericTool({ tool }: { tool: TimelineToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const raw = detailText(tool)
  const markdown = toolOutputAsMarkdown(tool, raw)
  return (
    <div className={styles.toolCard}>
      <button
        type="button"
        className={styles.toolCardHeader}
        onClick={() => setExpanded((v) => !v)}
        disabled={!markdown}
      >
        <span className={STATUS_CLASS[tool.status]} aria-hidden>
          {STATUS_GLYPH[tool.status]}
        </span>
        <span>{tool.label}</span>
        {markdown && (
          <span aria-hidden style={{ marginLeft: 'auto' }}>
            {expanded ? '▾' : '▸'}
          </span>
        )}
      </button>
      {expanded && markdown ? (
        <MarkdownBody content={markdown} className={styles.toolCardBody} compact />
      ) : null}
    </div>
  )
}
