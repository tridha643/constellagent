import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { CursorBashRow } from './CursorBashRow'

export function BashTool({ tool }: { tool: TimelineToolCall }) {
  return <CursorBashRow tool={tool} />
}
