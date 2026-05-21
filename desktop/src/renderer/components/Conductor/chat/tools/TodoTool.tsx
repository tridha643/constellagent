import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { CursorTodoList } from './CursorTodoList'

/** Codex `todowrite` / `todo_list` steps as Cursor-style compact rows. */
export function TodoTool({ tool }: { tool: TimelineToolCall }) {
  return <CursorTodoList tool={tool} />
}
