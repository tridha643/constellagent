import { useRef, useState } from 'react'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import type { TodoItem } from '../../store/types'
import { useAppStore } from '../../store/app-store'
import styles from './Checks.module.css'

export function TodosPanel({ workspaceId }: { workspaceId: string }) {
  const todos = useAppStore((s) => s.workspaceTodos[workspaceId])
  const addTodo = useAppStore((s) => s.addTodo)
  const renameTodo = useAppStore((s) => s.renameTodo)
  const toggleTodo = useAppStore((s) => s.toggleTodo)
  const removeTodo = useAppStore((s) => s.removeTodo)
  const reorderTodos = useAppStore((s) => s.reorderTodos)
  const clearCompletedTodos = useAppStore((s) => s.clearCompletedTodos)

  const list = todos ?? []
  const completedCount = list.filter((t) => t.done).length

  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const draggingIdRef = useRef<string | null>(null)

  const commitAdd = () => {
    const text = addText.trim()
    if (text) addTodo(workspaceId, text)
    setAddText('')
    setAdding(false)
  }

  const startEdit = (todo: TodoItem) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }
  const commitEdit = () => {
    if (editingId) renameTodo(workspaceId, editingId, editText)
    setEditingId(null)
    setEditText('')
  }

  const handleDrop = (targetId: string) => {
    const sourceId = draggingIdRef.current
    draggingIdRef.current = null
    setDraggingId(null)
    if (!sourceId || sourceId === targetId) return
    const ids = list.map((t) => t.id)
    const fromIndex = ids.indexOf(sourceId)
    const toIndex = ids.indexOf(targetId)
    if (fromIndex === -1 || toIndex === -1) return
    ids.splice(fromIndex, 1)
    ids.splice(toIndex, 0, sourceId)
    reorderTodos(workspaceId, ids)
  }

  return (
    <div className={styles.section}>
      <div className={styles.todosHeaderRow}>
        <span className={styles.todosTitle}>Your todos</span>
        {list.length > 0 && <span className={styles.todosCount}>{list.length}</span>}
        <button
          type="button"
          className={styles.addButton}
          onClick={() => {
            setAdding(true)
            setEditingId(null)
          }}
        >
          <Plus size={12} />
          Add
        </button>
        {completedCount > 0 && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => clearCompletedTodos(workspaceId)}
          >
            Clear completed
          </button>
        )}
      </div>

      {adding && (
        <div className={styles.todoRow}>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            className={styles.addInput}
            data-testid="todo-add-input"
            placeholder="New todo…"
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd()
              if (e.key === 'Escape') {
                setAddText('')
                setAdding(false)
              }
            }}
            onBlur={commitAdd}
          />
        </div>
      )}

      {list.length === 0 && !adding ? (
        <div className={styles.notice}>No todos yet</div>
      ) : (
        list.length > 0 && (
          <div className={styles.list} data-testid="todo-list">
            {list.map((todo) => (
              <div
                key={todo.id}
                className={`${styles.todoRow} ${draggingId === todo.id ? styles.todoRowDragging : ''}`}
                data-testid="todo-row"
                onDragOver={(e) => {
                  if (draggingIdRef.current) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  handleDrop(todo.id)
                }}
              >
                <span
                  className={styles.todoDragHandle}
                  draggable
                  onDragStart={() => {
                    draggingIdRef.current = todo.id
                    setDraggingId(todo.id)
                  }}
                  onDragEnd={() => {
                    draggingIdRef.current = null
                    setDraggingId(null)
                  }}
                  title="Drag to reorder"
                >
                  <GripVertical size={13} />
                </span>
                <input
                  type="checkbox"
                  className={styles.todoCheckbox}
                  checked={todo.done}
                  onChange={() => toggleTodo(workspaceId, todo.id)}
                  aria-label={todo.done ? 'Mark not done' : 'Mark done'}
                />
                {editingId === todo.id ? (
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  <input
                    autoFocus
                    className={styles.editInput}
                    data-testid="todo-edit-input"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') {
                        setEditingId(null)
                        setEditText('')
                      }
                    }}
                    onBlur={commitEdit}
                  />
                ) : (
                  <span
                    className={`${styles.todoText} ${todo.done ? styles.todoTextDone : ''}`}
                    onDoubleClick={() => startEdit(todo)}
                    title="Double-click to edit"
                  >
                    {todo.text}
                  </span>
                )}
                <button
                  type="button"
                  className={styles.todoDelete}
                  onClick={() => removeTodo(workspaceId, todo.id)}
                  aria-label="Delete todo"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
