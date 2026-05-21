import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { MarkdownBody } from '../MarkdownBody'
import styles from '../../Conductor.module.css'

type TodoStatus = 'pending' | 'in_progress' | 'completed'

interface NormalizedTodo {
  readonly text: string
  readonly status: TodoStatus
}

function rawTodos(tool: TimelineToolCall): unknown[] {
  if (Array.isArray(tool.input)) return tool.input
  if (tool.input && typeof tool.input === 'object') {
    const todos = (tool.input as { todos?: unknown }).todos
    if (Array.isArray(todos)) return todos
  }
  if (Array.isArray(tool.output)) return tool.output
  return []
}

function normalize(entry: unknown): NormalizedTodo | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const text =
    (typeof record.text === 'string' && record.text) ||
    (typeof record.content === 'string' && record.content) ||
    (typeof record.title === 'string' && record.title) ||
    ''
  if (!text) return null
  let status: TodoStatus = 'pending'
  if (typeof record.status === 'string' && ['pending', 'in_progress', 'completed'].includes(record.status)) {
    status = record.status as TodoStatus
  } else if (record.completed === true) {
    status = 'completed'
  }
  return { text, status }
}

function todosToMarkdown(todos: readonly NormalizedTodo[]): string {
  return todos
    .map((todo) => {
      const checked = todo.status === 'completed' ? 'x' : ' '
      const prefix = todo.status === 'in_progress' ? '*(in progress)* ' : ''
      return `- [${checked}] ${prefix}${todo.text}`
    })
    .join('\n')
}

/** Renders Codex `todowrite` todos through ProseMark task-list widgets. */
export function TodoTool({ tool }: { tool: TimelineToolCall }) {
  const todos = rawTodos(tool)
    .map(normalize)
    .filter((todo): todo is NormalizedTodo => todo !== null)
  if (todos.length === 0) return null
  return (
    <MarkdownBody content={todosToMarkdown(todos)} className={styles.todoMarkdown} compact />
  )
}
