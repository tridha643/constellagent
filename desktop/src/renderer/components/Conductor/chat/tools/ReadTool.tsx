import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { CursorReadRow } from './CursorReadRow'

export function ReadTool({ tool }: { tool: TimelineToolCall }) {
  return <CursorReadRow tool={tool} />
}
