import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import styles from './CursorTool.module.css'

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

function TodoCheckIcon({ done }: { done: boolean }) {
  if (!done) {
    return (
      <span className={styles.cursorTodoCheckOpen} aria-hidden>
        <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="8" cy="8" r="6" />
        </svg>
      </span>
    )
  }
  return (
    <span className={styles.cursorTodoCheckDone} aria-hidden>
      <svg viewBox="0 0 16 16" width={14} height={14} fill="none">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path
          d="M5.5 8.2 7.2 10 10.8 6.2"
          stroke="#fff"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/** Codex `todowrite` steps — compact rows (replaces blue ProseMark task-list card). */
export function CursorTodoList({ tool }: { tool: TimelineToolCall }) {
  const todos = rawTodos(tool)
    .map(normalize)
    .filter((todo): todo is NormalizedTodo => todo !== null)
  if (todos.length === 0) return null

  return (
    <div className={styles.cursorTodoList} data-testid="cursor-todo-list">
      {todos.map((todo, index) => (
        <div
          key={`${index}-${todo.text}`}
          className={styles.cursorTodoStep}
          data-status={todo.status}
          data-testid="cursor-todo-step"
        >
          <TodoCheckIcon done={todo.status === 'completed'} />
          <span className={styles.cursorTodoStepLabel}>{todo.text}</span>
        </div>
      ))}
    </div>
  )
}
