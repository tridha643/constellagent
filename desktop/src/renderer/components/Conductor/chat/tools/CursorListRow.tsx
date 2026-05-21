import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { pathFromInput } from './InlineTools'
import { CursorListDocIcon } from './CursorToolIcons'
import { CursorToolChip } from './CursorToolChip'
import styles from './CursorTool.module.css'

function firstString(input: unknown, keys: string[]): string | undefined {
  if (typeof input === 'string') return input.trim() || undefined
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return undefined
}

function listDirectoryLabel(input: unknown): string {
  const path = pathFromInput(input)
  if (path) {
    const cleaned = path.replace(/\\/g, '/').replace(/\/$/, '')
    const base = cleaned.split('/').pop()
    if (base) return base
    return cleaned || 'src'
  }
  const pattern = firstString(input, ['pattern', 'glob', 'query'])
  if (pattern) {
    const seg = pattern.replace(/\\/g, '/').split('/').filter(Boolean)[0]
    if (seg) return seg
  }
  return 'src'
}

export function CursorListRow({ tool }: { tool: TimelineToolCall }) {
  const dir = listDirectoryLabel(tool.input)

  return (
    <div className={styles.cursorToolRow} data-testid="cursor-tool-row">
      <div className={styles.cursorToolRowMain} data-testid="cursor-list-row" style={{ cursor: 'default' }}>
        <span className={styles.cursorToolIcon} aria-hidden>
          <CursorListDocIcon />
        </span>
        <span className={styles.cursorToolLabel}>List files</span>
        <CursorToolChip variant="directory" path={dir} />
      </div>
    </div>
  )
}
