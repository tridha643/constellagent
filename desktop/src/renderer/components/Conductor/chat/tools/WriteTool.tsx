import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { CursorDiffRow } from './CursorDiffRow'
import { filesFromTool } from './tool-file-change'
import styles from './CursorTool.module.css'

/** Compact write row: verb + bordered file chip + plain stats. */
export function WriteTool({ tool }: { tool: TimelineToolCall }) {
  const files = filesFromTool(tool)
  if (files.length === 1) {
    const file = files[0]!
    return <CursorDiffRow path={file.path} patch={file.patch} tool={tool} />
  }
  if (files.length > 1) {
    return (
      <div className={styles.cursorDiffStack}>
        {files.map((file) => (
          <CursorDiffRow key={file.path} path={file.path} patch={file.patch} tool={tool} />
        ))}
      </div>
    )
  }
  return null
}
