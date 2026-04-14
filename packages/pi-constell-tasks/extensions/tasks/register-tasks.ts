import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { Text, Type } from './compat.js'
import { ProcessTracker } from './process-tracker.js'
import {
  beginTurn,
  defaultRuntimeState,
  formatTaskStatusLabel,
  markCompletedTurn,
  maybeAutoClear,
  maybeTaskReminder,
  recordTaskToolUse,
  setActiveTask,
  TASK_TOOL_NAMES,
} from './runtime.js'
import {
  getOpenBlockers,
  loadTasksConfig,
  removeWorkspaceTaskRoot,
  resolveTaskStore,
  saveTasksConfig,
  TaskStore,
} from './task-store.js'
import type {
  Task,
  TaskCommandAction,
  TaskCreateParams,
  TaskExecuteParams,
  TaskOutputParams,
  TaskStopParams,
  TaskStoreContext,
  TaskUpdateParams,
} from './types.js'

const STATUS_KEY = 'pi-constell-tasks'

const TaskCreateSchema = Type.Object({
  subject: Type.String({ description: 'Short task title' }),
  description: Type.String({ description: 'Task description and intent' }),
  activeForm: Type.Optional(Type.String({ description: 'Present-tense activity label shown while active' })),
  agentType: Type.Optional(Type.String({ description: 'Optional execution owner type, stored in metadata.agentType' })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Optional metadata merged into the task' })),
})

const TaskUpdateSchema = Type.Object({
  taskId: Type.String(),
  status: Type.Optional(Type.Union([
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
    Type.Literal('cancelled'),
    Type.Literal('deleted'),
  ])),
  subject: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  activeForm: Type.Optional(Type.String()),
  owner: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Union([Type.Unknown(), Type.Null()]))),
  addBlocks: Type.Optional(Type.Array(Type.String())),
  addBlockedBy: Type.Optional(Type.Array(Type.String())),
})

const TaskOutputSchema = Type.Object({
  task_id: Type.String(),
  block: Type.Optional(Type.Boolean()),
  timeout: Type.Optional(Type.Number()),
})

const TaskStopSchema = Type.Object({
  task_id: Type.Optional(Type.String()),
  shell_id: Type.Optional(Type.String()),
})

const TaskExecuteSchema = Type.Object({
  task_ids: Type.Array(Type.String(), { minItems: 1 }),
  additional_context: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  max_turns: Type.Optional(Type.Number({ minimum: 1 })),
})

interface TaskHooks {
  resolveStoreContext: (ctx: ExtensionContext) => TaskStoreContext
}

export interface TaskController {
  toolNames: string[]
  beforeAgentStart: (ctx: ExtensionContext) => Promise<string | null>
  updateStatus: (ctx: ExtensionContext) => Promise<void>
  clearStatus: (ctx: ExtensionContext) => void
  cleanupWorkspace: (workspaceId: string) => Promise<void>
}

function summarizeTask(task: Task, allTasks: Task[]): string {
  const blockers = task.blockedBy.filter((id) => {
    const blocker = allTasks.find((candidate) => candidate.id === id)
    return blocker && !['completed', 'cancelled'].includes(blocker.status)
  })
  const blockedSuffix = blockers.length ? ` (blocked by ${blockers.map((id) => `#${id}`).join(', ')})` : ''
  return `#${task.id} [${task.status}] ${task.subject}${blockedSuffix}`
}

function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return 'No tasks yet.'
  return tasks.map((task) => summarizeTask(task, tasks)).join('\n')
}

function formatTaskDetails(task: Task, allTasks: Task[]): string {
  const blockers = getOpenBlockers(task, { schemaVersion: 1, nextId: 0, tasks: allTasks }).map((entry) => `#${entry.id}`)
  const lines = [
    `#${task.id}: ${task.subject}`,
    `Status: ${task.status}`,
    task.activeForm ? `Active form: ${task.activeForm}` : null,
    task.owner ? `Owner: ${task.owner}` : null,
    blockers.length ? `Blocked by: ${blockers.join(', ')}` : null,
    task.blocks.length ? `Blocks: ${task.blocks.map((id) => `#${id}`).join(', ')}` : null,
    task.description ? `Description:\n${task.description}` : null,
    task.output.length ? `Output:\n${task.output.join('')}` : null,
    Object.keys(task.metadata).length ? `Metadata:\n${JSON.stringify(task.metadata, null, 2)}` : null,
  ].filter(Boolean)
  return lines.join('\n\n')
}

function renderToolLabel(name: string, suffix: string): Text {
  return new Text(`${name} ${suffix}`, 0, 0)
}

function resultText(result: { content?: Array<{ type?: string; text?: string }> }): string {
  const first = result.content?.find((block) => block.type === 'text' && typeof block.text === 'string')
  return first?.text ?? ''
}

function getCommandText(task: Task, additionalContext?: string): string | null {
  const metadataCommand = typeof task.metadata.command === 'string' ? task.metadata.command.trim() : ''
  if (metadataCommand) return metadataCommand
  if (additionalContext?.trim()) return additionalContext.trim()
  return null
}

function formatCascadeNotice(started: string[]): string {
  return started.length ? `\nAuto-cascade started ${started.join(', ')}.` : ''
}

export default function registerTasks(pi: ExtensionAPI, hooks: TaskHooks): TaskController {
  const runtime = defaultRuntimeState()
  const tracker = new ProcessTracker()

  async function resolveStore(ctx: ExtensionContext) {
    const storeContext = hooks.resolveStoreContext(ctx)
    const resolved = await resolveTaskStore(storeContext)
    const store = new TaskStore(resolved)
    const config = await loadTasksConfig(storeContext)
    return { store, config, storeContext, resolved }
  }

  async function syncTrackedTask(taskId: string, store: TaskStore): Promise<Task | null> {
    const task = await store.get(taskId)
    if (!task) return null
    const outputChunks = tracker.consumeOutput(taskId)
    let next = task
    if (outputChunks.length > 0) {
      for (const chunk of outputChunks) next = await store.appendOutput(taskId, chunk)
    }
    const process = tracker.get(taskId)
    if (!process) return next
    if (process.status === 'running') {
      if (next.status !== 'in_progress') {
        next = { ...next, status: 'in_progress', startedAt: next.startedAt ?? Date.now(), updatedAt: Date.now() }
        await store.replaceTask(next)
      }
      setActiveTask(runtime, taskId)
      return next
    }

    if (process.status === 'completed') {
      next = {
        ...next,
        status: 'completed',
        completedAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {
          ...next.metadata,
          lastExitCode: process.exitCode ?? 0,
          lastCommand: process.command,
        },
      }
      markCompletedTurn(runtime, taskId)
    } else if (process.status === 'stopped') {
      next = {
        ...next,
        status: 'cancelled',
        stoppedAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {
          ...next.metadata,
          lastCommand: process.command,
        },
      }
    } else if (process.status === 'error') {
      next = {
        ...next,
        status: 'pending',
        lastError: process.lastError ?? 'Task execution failed.',
        updatedAt: Date.now(),
        metadata: {
          ...next.metadata,
          lastExitCode: process.exitCode ?? null,
          lastCommand: process.command,
        },
      }
    }
    await store.replaceTask(next)
    if (runtime.activeTaskIds[0] === taskId) setActiveTask(runtime, null)
    return next
  }

  async function startTrackedTask(task: Task, ctx: ExtensionContext, store: TaskStore, additionalContext?: string): Promise<boolean> {
    const command = getCommandText(task, additionalContext)
    if (!command) return false
    if (tracker.get(task.id)?.status === 'running') return false
    await store.update({ taskId: task.id, status: 'in_progress' })
    setActiveTask(runtime, task.id)
    await tracker.start(task.id, command, { cwd: hooks.resolveStoreContext(ctx).cwd, env: process.env })
    return true
  }

  async function maybeAutoCascadeTasks(ctx: ExtensionContext, store: TaskStore, config: Awaited<ReturnType<typeof loadTasksConfig>>): Promise<string[]> {
    if (!config.autoCascade) return []
    const data = await store.readStore()
    const ready = data.tasks
      .filter((task) => task.status === 'pending')
      .filter((task) => task.blockedBy.length > 0)
      .filter((task) => getOpenBlockers(task, data).length === 0)
      .filter((task) => Boolean(getCommandText(task)))
      .sort((left, right) => Number(left.id) - Number(right.id))
    const started: string[] = []
    for (const task of ready) {
      if (await startTrackedTask(task, ctx, store)) started.push(`#${task.id}`)
    }
    return started
  }

  async function reconcileRuntime(ctx: ExtensionContext, store: TaskStore, config: Awaited<ReturnType<typeof loadTasksConfig>>, allowCascade = false): Promise<string[]> {
    for (const activeTaskId of [...runtime.activeTaskIds]) await syncTrackedTask(activeTaskId, store)
    return allowCascade ? maybeAutoCascadeTasks(ctx, store, config) : []
  }

  async function refreshStatus(ctx: ExtensionContext): Promise<void> {
    try {
      const { store, config } = await resolveStore(ctx)
      await reconcileRuntime(ctx, store, config)
      const data = await store.readStore()
      const label = formatTaskStatusLabel(data, runtime)
      ctx.ui.setStatus(STATUS_KEY, label ? ctx.ui.theme.fg('accent', `• ${label}`) : undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task store unavailable'
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('warning', `• ${message}`))
    }
  }

  async function readTask(taskId: string, ctx: ExtensionContext): Promise<{ task: Task; all: Task[]; store: TaskStore }> {
    const { store } = await resolveStore(ctx)
    const all = await store.list()
    const task = all.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error(`Task #${taskId} does not exist.`)
    return { task, all, store }
  }

  async function maybeRunTaskMenu(ctx: ExtensionContext): Promise<void> {
    const ui = ctx.ui as unknown as {
      select?: (title: string, options: TaskCommandAction[]) => Promise<string | null>
      input?: (title: string, initialValue?: string) => Promise<string | null>
      notify: (message: string, type?: string) => void
    }
    const { store, storeContext, config } = await resolveStore(ctx)
    const tasks = await store.list()
    if (!ui.select || !ui.input) {
      ui.notify(`Tasks\n${formatTaskList(tasks)}`, 'info')
      return
    }
    const choice = await ui.select('Tasks', [
      { label: 'View tasks', value: 'view', description: 'Show current workspace tasks' },
      { label: 'Create task', value: 'create', description: 'Add a new workspace task' },
      { label: 'Clear completed', value: 'clear-completed', description: 'Remove completed or cancelled tasks' },
      { label: 'Clear all', value: 'clear-all', description: 'Remove every task in this workspace list' },
      { label: 'Settings', value: 'settings', description: 'Configure scope, auto-cascade, and auto-clear' },
    ])
    if (!choice) return
    if (choice === 'view') {
      ui.notify(formatTaskList(tasks), 'info')
      return
    }
    if (choice === 'create') {
      const subject = await ui.input('Task subject')
      if (!subject?.trim()) return
      const description = await ui.input('Task description')
      if (!description?.trim()) return
      const task = await store.create({ subject, description })
      ui.notify(`Created task #${task.id}: ${task.subject}`, 'info')
      await refreshStatus(ctx)
      return
    }
    if (choice === 'clear-completed') {
      const removed = await store.clearCompleted()
      ui.notify(removed ? `Removed ${removed} completed task(s).` : 'No completed tasks to clear.', 'info')
      await refreshStatus(ctx)
      return
    }
    if (choice === 'clear-all') {
      await store.clearAll()
      ui.notify('Cleared all workspace tasks.', 'warning')
      await refreshStatus(ctx)
      return
    }
    if (choice === 'settings') {
      const mode = await ui.select('Task storage mode', [
        { label: 'Workspace', value: 'workspace', description: 'Shared task list for this workspace' },
        { label: 'Session', value: 'session', description: `Session-scoped task file (${storeContext.sessionId})` },
        { label: 'Memory', value: 'memory', description: 'No file persistence for tasks' },
      ])
      const autoCascade = await ui.select('Auto-cascade', [
        { label: 'Disabled', value: 'false', description: 'Only execute tasks when explicitly requested' },
        { label: 'Enabled', value: 'true', description: 'Advance to newly unblocked tasks automatically' },
      ])
      const autoClear = await ui.select('Auto-clear completed', [
        { label: 'Never', value: 'never' },
        { label: 'When list complete', value: 'on_list_complete' },
        { label: 'Per task after delay', value: 'on_task_complete' },
      ])
      await saveTasksConfig(storeContext, {
        taskScope: (mode as 'workspace' | 'session' | 'memory' | null) ?? config.taskScope,
        autoCascade: autoCascade ? autoCascade === 'true' : config.autoCascade,
        autoClearCompleted: (autoClear as 'never' | 'on_list_complete' | 'on_task_complete' | null) ?? config.autoClearCompleted,
      })
      ui.notify('Saved workspace task settings.', 'info')
      await refreshStatus(ctx)
    }
  }

  pi.registerTool({
    name: 'TaskCreate',
    label: 'Task Create',
    description: 'Create a workspace task in the native pi-constell task store.',
    promptSnippet: 'Create native workspace tasks for the shared implementation graph instead of hiding progress in freeform prose.',
    promptGuidelines: [
      'Use TaskCreate when a workspace execution step should be tracked explicitly.',
      'Keep task subjects concise, use description for the why, and attach execution hints in metadata when needed.',
    ],
    parameters: TaskCreateSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store } = await resolveStore(ctx)
      const task = await store.create(params as TaskCreateParams)
      recordTaskToolUse(runtime)
      await refreshStatus(ctx)
      return { content: [{ type: 'text', text: `Created task #${task.id}: ${task.subject}` }], details: task }
    },
    renderCall(args) { return renderToolLabel('TaskCreate', String(args.subject ?? '')) },
    renderResult(result) { return new Text(resultText(result) || 'Task created', 0, 0) },
  })

  pi.registerTool({
    name: 'TaskList',
    label: 'Task List',
    description: 'List native workspace tasks for the current pi workspace.',
    promptSnippet: 'List tracked tasks before starting or resuming work so the implementation graph stays synchronized.',
    promptGuidelines: ['Use TaskList to understand the current task graph and detect blocked or in-progress work.'],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const { store, config } = await resolveStore(ctx)
      await reconcileRuntime(ctx, store, config)
      const tasks = await store.list()
      recordTaskToolUse(runtime)
      await refreshStatus(ctx)
      return { content: [{ type: 'text', text: formatTaskList(tasks) }], details: tasks }
    },
    renderCall() { return renderToolLabel('TaskList', '') },
    renderResult(result) { return new Text(resultText(result) || 'No tasks', 0, 0) },
  })

  pi.registerTool({
    name: 'TaskGet',
    label: 'Task Get',
    description: 'Read one task from the native workspace task store.',
    promptSnippet: 'Inspect a single tracked task including blockers, output, and metadata.',
    promptGuidelines: ['Use TaskGet before editing or executing a task when details matter.'],
    parameters: Type.Object({ taskId: Type.String() }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { task, all, store } = await readTask(String(params.taskId), ctx)
      await syncTrackedTask(task.id, store)
      const refreshed = await store.get(task.id)
      recordTaskToolUse(runtime)
      await refreshStatus(ctx)
      return { content: [{ type: 'text', text: formatTaskDetails(refreshed ?? task, all) }], details: refreshed ?? task }
    },
    renderCall(args) { return renderToolLabel('TaskGet', `#${String(args.taskId ?? '')}`) },
    renderResult(result) { return new Text(resultText(result) || 'Task loaded', 0, 0) },
  })

  pi.registerTool({
    name: 'TaskUpdate',
    label: 'Task Update',
    description: 'Update task status, metadata, and dependency links in the native workspace task store.',
    promptSnippet: 'Update native tasks whenever execution state changes, dependencies are added, or a task is deleted.',
    promptGuidelines: [
      'Prefer TaskUpdate over editing task files directly.',
      'Use addBlocks/addBlockedBy to maintain dependency edges; warnings are returned for missing or cyclic links.',
    ],
    parameters: TaskUpdateSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, config } = await resolveStore(ctx)
      const result = await store.update(params as TaskUpdateParams)
      if (result.task?.status === 'in_progress') setActiveTask(runtime, result.task.id)
      if (result.task?.status === 'completed' || result.task?.status === 'cancelled') markCompletedTurn(runtime, result.task.id)
      await maybeAutoClear(store, runtime, config.autoClearCompleted)
      const autoStarted = await maybeAutoCascadeTasks(ctx, store, config)
      recordTaskToolUse(runtime)
      await refreshStatus(ctx)
      const warningText = result.warnings.length ? `\nWarnings:\n- ${result.warnings.map((warning) => warning.message).join('\n- ')}` : ''
      return {
        content: [{
          type: 'text',
          text: `${result.task ? `Updated task #${result.task.id}.` : `Deleted task #${String(params.taskId)}.`}${warningText}${formatCascadeNotice(autoStarted)}`,
        }],
        details: result,
      }
    },
    renderCall(args) { return renderToolLabel('TaskUpdate', `#${String(args.taskId ?? '')}`) },
    renderResult(result) { return new Text(resultText(result) || 'Task updated', 0, 0) },
  })

  pi.registerTool({
    name: 'TaskOutput',
    label: 'Task Output',
    description: 'Inspect buffered output for an executing task and optionally wait for completion.',
    promptSnippet: 'Use TaskOutput to read task output, especially after TaskExecute starts a background command.',
    promptGuidelines: ['When block is true, wait briefly for completion before returning output.'],
    parameters: TaskOutputSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const taskId = String((params as TaskOutputParams).task_id)
      const { store, config } = await resolveStore(ctx)
      const background = tracker.get(taskId)
      if (background && (params as TaskOutputParams).block !== false) {
        await tracker.waitForCompletion(taskId, Math.max(0, Math.min(Number((params as TaskOutputParams).timeout ?? 30000), 600000)))
      }
      const task = await syncTrackedTask(taskId, store) ?? await store.get(taskId)
      if (!task) throw new Error(`Task #${taskId} does not exist.`)
      const autoStarted = await maybeAutoCascadeTasks(ctx, store, config)
      recordTaskToolUse(runtime)
      await refreshStatus(ctx)
      return {
        content: [{
          type: 'text',
          text: `${task.output.length ? task.output.join('') : `No output recorded for task #${taskId}.`}${formatCascadeNotice(autoStarted)}`,
        }],
        details: task,
      }
    },
    renderCall(args) { return renderToolLabel('TaskOutput', `#${String(args.task_id ?? '')}`) },
    renderResult(result) { return new Text(resultText(result) || 'No output', 0, 0) },
  })

  pi.registerTool({
    name: 'TaskStop',
    label: 'Task Stop',
    description: 'Stop a running task execution and mark it cancelled.',
    promptSnippet: 'Stop a running task when execution should halt cleanly.',
    promptGuidelines: ['Prefer TaskStop over abandoning an in-progress task silently.'],
    parameters: TaskStopSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const taskId = String((params as TaskStopParams).task_id ?? (params as TaskStopParams).shell_id ?? '')
      if (!taskId) throw new Error('TaskStop requires task_id or shell_id.')
      const { store, config } = await resolveStore(ctx)
      await tracker.stop(taskId)
      await syncTrackedTask(taskId, store)
      await maybeAutoClear(store, runtime, config.autoClearCompleted)
      const autoStarted = await maybeAutoCascadeTasks(ctx, store, config)
      recordTaskToolUse(runtime)
      await refreshStatus(ctx)
      return {
        content: [{ type: 'text', text: `Stopped task #${taskId}.${formatCascadeNotice(autoStarted)}` }],
        details: await store.get(taskId),
      }
    },
    renderCall(args) { return renderToolLabel('TaskStop', `#${String(args.task_id ?? args.shell_id ?? '')}`) },
    renderResult(result) { return new Text(resultText(result) || 'Task stopped', 0, 0) },
  })

  pi.registerTool({
    name: 'TaskExecute',
    label: 'Task Execute',
    description: 'Execute one or more tasks natively using background shell commands when available.',
    promptSnippet: 'Execute tasks after they are ready. Use metadata.command or additional_context to provide the command to run.',
    promptGuidelines: [
      'Prefer metadata.command for deterministic execution.',
      'When no native execution integration is available, TaskExecute should fail clearly instead of pretending it ran.',
    ],
    parameters: TaskExecuteSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store } = await resolveStore(ctx)
      const started: string[] = []
      for (const taskId of (params as TaskExecuteParams).task_ids) {
        const task = await store.get(taskId)
        if (!task) throw new Error(`Task #${taskId} does not exist.`)
        const openBlockers = getOpenBlockers(task, await store.readStore())
        if (openBlockers.length > 0) {
          throw new Error(`Task #${task.id} is blocked by ${openBlockers.map((entry) => `#${entry.id}`).join(', ')}.`)
        }
        if (!getCommandText(task, (params as TaskExecuteParams).additional_context)) {
          throw new Error(`Task #${task.id} cannot execute because it has no metadata.command and no execution context was provided.`)
        }
        if (await startTrackedTask(task, ctx, store, (params as TaskExecuteParams).additional_context)) started.push(`#${task.id}`)
      }
      recordTaskToolUse(runtime)
      await refreshStatus(ctx)
      return { content: [{ type: 'text', text: `Started ${started.join(', ')}.` }], details: started }
    },
    renderCall(args) { return renderToolLabel('TaskExecute', `${Array.isArray(args.task_ids) ? args.task_ids.length : 0} task(s)`) },
    renderResult(result) { return new Text(resultText(result) || 'Task execution started', 0, 0) },
  })

  pi.registerCommand('tasks', {
    description: 'Open the native pi-constell task surface',
    handler: async (_args, ctx) => maybeRunTaskMenu(ctx),
  })

  return {
    toolNames: [...TASK_TOOL_NAMES],
    beforeAgentStart: async (ctx) => {
      try {
        const { store, config } = await resolveStore(ctx)
        beginTurn(runtime)
        await reconcileRuntime(ctx, store, config, true)
        await maybeAutoClear(store, runtime, config.autoClearCompleted)
        const data = await store.readStore()
        const reminder = maybeTaskReminder(data, runtime)
        await refreshStatus(ctx)
        if (data.tasks.length === 0 && !reminder) return null
        const summary = data.tasks.length ? `Current task store:\n${formatTaskList(await store.list())}` : null
        return [reminder, summary].filter(Boolean).join('\n\n') || null
      } catch (error) {
        await refreshStatus(ctx)
        return error instanceof Error ? `Task store note: ${error.message}` : null
      }
    },
    updateStatus: refreshStatus,
    clearStatus: (ctx) => {
      ctx.ui.setStatus(STATUS_KEY, undefined)
    },
    cleanupWorkspace: async (workspaceId: string) => {
      await removeWorkspaceTaskRoot(workspaceId)
    },
  }
}
