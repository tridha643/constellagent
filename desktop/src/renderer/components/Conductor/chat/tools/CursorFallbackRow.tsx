import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { pathFromInput } from './InlineTools'
import { CursorReadDocIcon } from './CursorToolIcons'
import { CursorToolChip } from './CursorToolChip'
import styles from './CursorTool.module.css'

/** Cursor-styled row for harness tools we cannot classify (replaces bordered GenericTool card). */
export function CursorFallbackRow({ tool }: { tool: TimelineToolCall }) {
  const path = pathFromInput(tool.input)
  const label = tool.label.trim() || tool.toolName

  return (
    <div className={styles.cursorToolRow} data-testid="cursor-tool-row">
      <div className={styles.cursorToolRowMain} data-testid="cursor-fallback-row">
        <span className={styles.cursorToolIcon} aria-hidden>
          <CursorReadDocIcon />
        </span>
        <span className={styles.cursorToolLabel}>{label}</span>
        {path ? <CursorToolChip variant="file" path={path} onClick={(e) => e.preventDefault()} /> : null}
      </div>
    </div>
  )
}
