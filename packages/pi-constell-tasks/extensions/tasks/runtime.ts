import type { Task, TaskAutoClearMode, TaskRuntimeState, TaskStoreData } from './types.js'
import { getOpenBlockers, TaskStore } from './task-store.js'

const REMINDER_INTERVAL = 4
const AUTO_CLEAR_DELAY_TURNS = 4

export const TASK_TOOL_NAMES = [
  'TaskCreate',
  'TaskList',
  'TaskGet',
  'TaskUpdate',
  'TaskOutput',
  'TaskStop',
  'TaskExecute',
] as const

export const TASK_REMINDER =
  'Task reminder: use the native task tools to keep the shared workspace task graph synchronized while you implement the stored plan.'

export function defaultRuntimeState(): TaskRuntimeState {
  return {
    activeTaskIds: [],
    activePidByTaskId: {},
    tokensByTaskId: {},
    currentTurn: 0,
    lastTaskToolTurn: 0,
    reminderInjectedThisCycle: false,
    completedTurnByTaskId: {},
  }
}

function blockedTasks(tasks: Task[], data: TaskStoreData): Task[] {
  return tasks.filter((task) => task.status === 'pending' && getOpenBlockers(task, data).length > 0)
}

function formatElapsed(startedAt: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

export function formatTaskStatusLabel(data: TaskStoreData, state: TaskRuntimeState): string | undefined {
  if (data.tasks.length === 0) return undefined
  const pending = data.tasks.filter((task) => task.status === 'pending').length
  const inProgress = data.tasks.filter((task) => task.status === 'in_progress').length
  const completed = data.tasks.filter((task) => task.status === 'completed').length
  const blocked = blockedTasks(data.tasks, data).length
  const active = state.activeTaskIds[0]
  const activeTask = active ? data.tasks.find((task) => task.id === active) : undefined
  const activeLabel = active
    ? ` · active #${active}${activeTask?.startedAt ? ` · ${formatElapsed(activeTask.startedAt)}` : ''}`
    : ''
  return `Tasks ${data.tasks.length} · ${completed} done · ${inProgress} in progress · ${pending} pending · ${blocked} blocked${activeLabel}`
}

export function maybeTaskReminder(data: TaskStoreData, state: TaskRuntimeState): string | null {
  if (data.tasks.length === 0) return null
  if (state.reminderInjectedThisCycle) return null
  if (state.currentTurn - state.lastTaskToolTurn < REMINDER_INTERVAL) return null
  state.reminderInjectedThisCycle = true
  state.lastTaskToolTurn = state.currentTurn
  return TASK_REMINDER
}

export function beginTurn(state: TaskRuntimeState): void {
  state.currentTurn += 1
  state.reminderInjectedThisCycle = false
}

export function recordTaskToolUse(state: TaskRuntimeState): void {
  state.lastTaskToolTurn = state.currentTurn
  state.reminderInjectedThisCycle = false
}

export function setActiveTask(state: TaskRuntimeState, taskId: string | null): void {
  state.activeTaskIds = taskId ? [taskId] : []
}

export function markCompletedTurn(state: TaskRuntimeState, taskId: string): void {
  state.completedTurnByTaskId ??= {}
  state.completedTurnByTaskId[taskId] = state.currentTurn
}

export async function maybeAutoClear(
  store: TaskStore,
  state: TaskRuntimeState,
  mode: TaskAutoClearMode,
): Promise<number> {
  if (mode === 'never') return 0
  const data = await store.readStore()
  const doneIds = data.tasks
    .filter((task) => task.status === 'completed' || task.status === 'cancelled')
    .map((task) => task.id)
  if (doneIds.length === 0) return 0

  if (mode === 'on_task_complete') {
    const eligible = doneIds.filter((taskId) =>
      state.completedTurnByTaskId?.[taskId] !== undefined &&
      state.currentTurn - (state.completedTurnByTaskId?.[taskId] ?? 0) >= AUTO_CLEAR_DELAY_TURNS,
    )
    if (eligible.length === 0) return 0
    for (const taskId of eligible) {
      if (state.completedTurnByTaskId) delete state.completedTurnByTaskId[taskId]
    }
    return store.clearCompleted(eligible)
  }

  const allDone = data.tasks.every((task) => task.status === 'completed' || task.status === 'cancelled')
  if (!allDone) {
    state.batchCompletedTurn = undefined
    return 0
  }
  state.batchCompletedTurn ??= state.currentTurn
  if (state.currentTurn - state.batchCompletedTurn < AUTO_CLEAR_DELAY_TURNS) return 0
  state.batchCompletedTurn = undefined
  return store.clearCompleted()
}
