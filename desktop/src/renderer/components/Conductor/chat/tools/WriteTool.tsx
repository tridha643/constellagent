import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { EditIcon } from '../ConductorIcons'
import { FilePathChip } from '../FilePathChip'
import { pathFromInput } from './InlineTools'
import styles from '../../Conductor.module.css'

/** Compact write row: icon + label + clickable file chip (no diff body). */
export function WriteTool({ tool }: { tool: TimelineToolCall }) {
  const path = pathFromInput(tool.input)
  return (
    <div className={styles.toolInline}>
      <span className={styles.toolInlineIcon} aria-hidden>
        <EditIcon size={13} />
      </span>
      <span className={styles.toolInlineLabel}>Wrote</span>
      {path ? <FilePathChip path={path} /> : null}
    </div>
  )
}
