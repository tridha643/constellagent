import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { CursorDiffFallbackRow, CursorDiffRow } from './CursorDiffRow'
import { filesFromTool } from './tool-file-change'
import styles from './CursorTool.module.css'

/** File edits: compact Cursor-style row; row click unlocks inline diff. */
export function DiffTool({ tool }: { tool: TimelineToolCall }) {
  const files = filesFromTool(tool)
  if (files.length === 0) {
    return <CursorDiffFallbackRow tool={tool} />
  }

  if (files.length === 1) {
    const file = files[0]!
    return <CursorDiffRow path={file.path} patch={file.patch} tool={tool} />
  }

  return (
    <div className={styles.cursorDiffStack}>
      {files.map((file) => (
        <CursorDiffRow key={file.path} path={file.path} patch={file.patch} tool={tool} />
      ))}
    </div>
  )
}
